use ort::session::Session;
use tokenizers::Tokenizer;

use crate::error::{AppError, AppResult};

/// CLIP image normalization constants (ImageNet statistics).
const CLIP_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const CLIP_STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Image resize target for the vision encoder.
const IMAGE_SIZE: usize = 256;

/// Embedding dimensionality produced by MobileCLIP-S2.
pub const EMBEDDING_DIM: usize = 512;

/// Encode a batch of text strings into L2-normalized CLIP embeddings.
///
/// # Arguments
/// * `session` - The ONNX text encoder session (MobileCLIP-S2 text).
/// * `tokenizer` - The HuggingFace tokenizer for the text model.
/// * `texts` - Slice of text strings to encode.
///
/// # Returns
/// A vector of 512-dimensional L2-normalized embeddings, one per input text.
pub fn encode_texts(
    session: &mut Session,
    tokenizer: &Tokenizer,
    texts: &[&str],
) -> AppResult<Vec<[f32; EMBEDDING_DIM]>> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    // Tokenize all texts
    let encodings = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| AppError::Custom(format!("Tokenization failed: {e}")))?;

    // CLIP models have a fixed context window of 77 tokens.
    // Pad shorter sequences and truncate longer ones to exactly 77.
    const SEQ_LEN: usize = 77;
    let batch_size = encodings.len();

    // Build input_ids and attention_mask as flat Vec<i64> with shape (batch_size, SEQ_LEN)
    let mut input_ids_data = vec![0i64; batch_size * SEQ_LEN];
    let mut attention_mask_data = vec![0i64; batch_size * SEQ_LEN];

    for (i, encoding) in encodings.iter().enumerate() {
        let ids = encoding.get_ids();
        let mask = encoding.get_attention_mask();
        let len = ids.len().min(SEQ_LEN);
        for j in 0..len {
            input_ids_data[i * SEQ_LEN + j] = ids[j] as i64;
            attention_mask_data[i * SEQ_LEN + j] = mask[j] as i64;
        }
    }

    // Create ONNX tensors using the (shape, data) tuple API to avoid ndarray version conflicts
    let shape = vec![batch_size as i64, SEQ_LEN as i64];
    let input_ids_tensor = ort::value::Tensor::from_array((shape.clone(), input_ids_data.into_boxed_slice()))
        .map_err(|e| AppError::Custom(format!("Failed to create input_ids tensor: {e}")))?;
    let attention_mask_tensor = ort::value::Tensor::from_array((shape, attention_mask_data.into_boxed_slice()))
        .map_err(|e| AppError::Custom(format!("Failed to create attention_mask tensor: {e}")))?;

    let outputs = session
        .run(ort::inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
        ])
        .map_err(|e| AppError::Custom(format!("Text encoder inference failed: {e}")))?;

    // Extract embeddings from the first output
    let (_, raw_data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| AppError::Custom(format!("Failed to extract text embeddings: {e}")))?;

    // raw_data is a flat slice of shape [batch_size, EMBEDDING_DIM]
    let mut embeddings = Vec::with_capacity(batch_size);
    for i in 0..batch_size {
        let start = i * EMBEDDING_DIM;
        let end = start + EMBEDDING_DIM;
        if end > raw_data.len() {
            return Err(AppError::Custom(format!(
                "Text embedding output too short: expected {} elements, got {}",
                batch_size * EMBEDDING_DIM,
                raw_data.len()
            )));
        }
        let mut emb = [0f32; EMBEDDING_DIM];
        emb.copy_from_slice(&raw_data[start..end]);
        l2_normalize(&mut emb);
        embeddings.push(emb);
    }

    Ok(embeddings)
}

/// Encode a single image (as raw bytes) into an L2-normalized CLIP embedding.
///
/// The image is decoded, resized to 256x256, normalized with CLIP statistics,
/// and fed through the vision ONNX encoder.
///
/// # Arguments
/// * `session` - The ONNX vision encoder session (MobileCLIP-S2 vision).
/// * `image_bytes` - Raw image file bytes (JPEG, PNG, GIF, WebP, etc.).
///
/// # Returns
/// A single 512-dimensional L2-normalized embedding.
pub fn encode_image(
    session: &mut Session,
    image_bytes: &[u8],
) -> AppResult<[f32; EMBEDDING_DIM]> {
    // Decode the image
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| AppError::Custom(format!("Failed to decode image: {e}")))?;

    // Resize to IMAGE_SIZE x IMAGE_SIZE using CatmullRom (bicubic)
    let resized = img.resize_exact(
        IMAGE_SIZE as u32,
        IMAGE_SIZE as u32,
        image::imageops::FilterType::CatmullRom,
    );

    let rgb = resized.to_rgb8();

    // Build a [1, 3, H, W] f32 tensor with CLIP normalization.
    // Layout: channel-first (CHW).
    let mut pixel_data = vec![0f32; 3 * IMAGE_SIZE * IMAGE_SIZE];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let pixel = rgb.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                let val = pixel[c] as f32 / 255.0;
                let normalized = (val - CLIP_MEAN[c]) / CLIP_STD[c];
                pixel_data[c * IMAGE_SIZE * IMAGE_SIZE + y * IMAGE_SIZE + x] = normalized;
            }
        }
    }

    let shape = [1usize, 3, IMAGE_SIZE, IMAGE_SIZE];
    let input_tensor = ort::value::Tensor::from_array((shape, pixel_data.into_boxed_slice()))
        .map_err(|e| AppError::Custom(format!("Failed to create image tensor: {e}")))?;

    let outputs = session
        .run(ort::inputs![input_tensor])
        .map_err(|e| AppError::Custom(format!("Vision encoder inference failed: {e}")))?;

    // Extract the embedding
    let (_, raw_data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| AppError::Custom(format!("Failed to extract image embedding: {e}")))?;

    if raw_data.len() < EMBEDDING_DIM {
        return Err(AppError::Custom(format!(
            "Image embedding output too short: expected {} elements, got {}",
            EMBEDDING_DIM,
            raw_data.len()
        )));
    }

    let mut emb = [0f32; EMBEDDING_DIM];
    emb.copy_from_slice(&raw_data[..EMBEDDING_DIM]);
    l2_normalize(&mut emb);

    Ok(emb)
}

/// Convert a 512-dim f32 embedding to a byte blob (little-endian, 2048 bytes).
pub fn embedding_to_blob(embedding: &[f32; EMBEDDING_DIM]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(EMBEDDING_DIM * 4);
    for &val in embedding.iter() {
        blob.extend_from_slice(&val.to_le_bytes());
    }
    blob
}

/// Convert a byte blob back to a 512-dim f32 embedding.
///
/// Returns an error if the blob is too short (< 2048 bytes).
pub fn blob_to_embedding(blob: &[u8]) -> AppResult<[f32; EMBEDDING_DIM]> {
    if blob.len() < EMBEDDING_DIM * 4 {
        return Err(AppError::Custom(format!(
            "Embedding blob too short: expected {} bytes, got {}",
            EMBEDDING_DIM * 4,
            blob.len()
        )));
    }
    let mut embedding = [0f32; EMBEDDING_DIM];
    for (i, chunk) in blob.chunks_exact(4).take(EMBEDDING_DIM).enumerate() {
        embedding[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
    }
    Ok(embedding)
}

/// Cosine similarity between two L2-normalized embeddings (= dot product).
pub fn cosine_similarity(a: &[f32; EMBEDDING_DIM], b: &[f32; EMBEDDING_DIM]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// L2-normalize an embedding vector in place.
fn l2_normalize(v: &mut [f32; EMBEDDING_DIM]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_roundtrip() {
        let mut emb = [0f32; EMBEDDING_DIM];
        for (i, v) in emb.iter_mut().enumerate() {
            *v = i as f32 * 0.001;
        }
        let blob = embedding_to_blob(&emb);
        assert_eq!(blob.len(), EMBEDDING_DIM * 4);
        let recovered = blob_to_embedding(&blob).unwrap();
        assert_eq!(emb, recovered);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let mut a = [0f32; EMBEDDING_DIM];
        a[0] = 1.0;
        a[1] = 0.5;
        l2_normalize(&mut a);
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let mut a = [0f32; EMBEDDING_DIM];
        let mut b = [0f32; EMBEDDING_DIM];
        a[0] = 1.0;
        b[1] = 1.0;
        l2_normalize(&mut a);
        l2_normalize(&mut b);
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }
}

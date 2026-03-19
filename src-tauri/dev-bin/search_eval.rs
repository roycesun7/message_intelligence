//! Comprehensive semantic search quality evaluation binary.
//!
//! Uses the actual MobileCLIP-S2 text encoder to evaluate search quality
//! across diverse query categories against the existing 4133 chunk embeddings.
//!
//! Usage: cargo run --bin search_eval

use rusqlite::Connection;
use std::collections::HashMap;
use std::io::Write;

const EMBEDDING_DIM: usize = 512;

/// A loaded chunk with its embedding and metadata.
struct ChunkRecord {
    chunk_id: i64,
    text: String,
    is_from_me: bool,
    message_count: i64,
    vector: [f32; EMBEDDING_DIM],
}

/// Result for a single query.
struct QueryResult {
    query: String,
    category: String,
    top_results: Vec<ScoredResult>,
    score_stats: ScoreStats,
    relevance_hits: usize,
    relevance_total: usize,
}

struct ScoredResult {
    score: f32,
    text: String,
    text_len: usize,
    message_count: i64,
    is_from_me: bool,
    has_keyword_overlap: bool,
}

struct ScoreStats {
    top1: f32,
    top5_max: f32,
    top5_min: f32,
    top5_median: f32,
    top5_mean: f32,
    top10_mean: f32,
    top20_mean: f32,
    global_mean: f32,
    global_std: f32,
    percentile_95: f32,
    percentile_90: f32,
    percentile_75: f32,
}

fn cosine_similarity(a: &[f32; EMBEDDING_DIM], b: &[f32; EMBEDDING_DIM]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn blob_to_embedding(blob: &[u8]) -> Option<[f32; EMBEDDING_DIM]> {
    if blob.len() < EMBEDDING_DIM * 4 {
        return None;
    }
    let mut embedding = [0f32; EMBEDDING_DIM];
    for (i, chunk) in blob.chunks_exact(4).take(EMBEDDING_DIM).enumerate() {
        embedding[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
    }
    Some(embedding)
}

fn l2_normalize(v: &mut [f32; EMBEDDING_DIM]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Encode a query using the CLIP text encoder.
fn encode_query(
    session: &mut ort::session::Session,
    tokenizer: &tokenizers::Tokenizer,
    query: &str,
) -> Option<[f32; EMBEDDING_DIM]> {
    let encodings = tokenizer.encode_batch(vec![query], true).ok()?;
    const SEQ_LEN: usize = 77;
    let batch_size = encodings.len();
    let mut input_ids_data = vec![0i64; batch_size * SEQ_LEN];
    for (i, encoding) in encodings.iter().enumerate() {
        let ids = encoding.get_ids();
        let len = ids.len().min(SEQ_LEN);
        for j in 0..len {
            input_ids_data[i * SEQ_LEN + j] = ids[j] as i64;
        }
    }
    let shape = vec![batch_size as i64, SEQ_LEN as i64];
    let input_ids_tensor =
        ort::value::Tensor::from_array((shape, input_ids_data.into_boxed_slice())).ok()?;
    let outputs = session
        .run(ort::inputs!["input_ids" => input_ids_tensor])
        .ok()?;
    let (_, raw_data) = outputs[0].try_extract_tensor::<f32>().ok()?;
    if raw_data.len() < EMBEDDING_DIM {
        return None;
    }
    let mut emb = [0f32; EMBEDDING_DIM];
    emb.copy_from_slice(&raw_data[..EMBEDDING_DIM]);
    l2_normalize(&mut emb);
    Some(emb)
}

/// Simple keyword overlap check: does the chunk text contain any of the query words?
fn check_keyword_overlap(query: &str, text: &str) -> bool {
    let query_words: Vec<&str> = query.split_whitespace().collect();
    let text_lower = text.to_lowercase();
    query_words
        .iter()
        .any(|w| text_lower.contains(&w.to_lowercase()))
}

/// Extended relevance check with synonyms and related terms.
fn check_relevance(query: &str, text: &str) -> bool {
    let text_lower = text.to_lowercase();

    // Direct keyword overlap
    if check_keyword_overlap(query, text) {
        return true;
    }

    // Synonym / related-term map for broader relevance checking
    let synonym_groups: Vec<(&str, Vec<&str>)> = vec![
        (
            "food restaurant",
            vec![
                "eat",
                "dinner",
                "lunch",
                "breakfast",
                "cook",
                "recipe",
                "hungry",
                "pizza",
                "sushi",
                "burger",
                "restaurant",
                "meal",
                "snack",
                "order",
                "takeout",
                "delivery",
                "cafe",
                "brunch",
            ],
        ),
        (
            "travel plans",
            vec![
                "trip",
                "flight",
                "hotel",
                "vacation",
                "airport",
                "plane",
                "booking",
                "travel",
                "visit",
                "abroad",
                "ticket",
                "destination",
            ],
        ),
        (
            "app development",
            vec![
                "code",
                "coding",
                "program",
                "software",
                "build",
                "feature",
                "bug",
                "deploy",
                "tech",
                "startup",
                "project",
                "api",
                "database",
            ],
        ),
        (
            "work career",
            vec![
                "job",
                "work",
                "office",
                "meeting",
                "boss",
                "salary",
                "promotion",
                "interview",
                "resume",
                "career",
                "colleague",
                "manager",
                "deadline",
            ],
        ),
        (
            "happy excited",
            vec![
                "awesome",
                "great",
                "amazing",
                "love",
                "excited",
                "happy",
                "glad",
                "yay",
                "wooo",
                "nice",
                "perfect",
                "incredible",
                "!!",
                "lol",
                "haha",
            ],
        ),
        (
            "frustrated angry",
            vec![
                "annoyed",
                "pissed",
                "mad",
                "upset",
                "frustrated",
                "angry",
                "hate",
                "wtf",
                "ugh",
                "terrible",
                "awful",
                "ridiculous",
            ],
        ),
        (
            "sad missing",
            vec![
                "miss",
                "sad",
                "lonely",
                "depressed",
                "crying",
                "sorry",
                "heartbreak",
                "lost",
                "gone",
                "wish",
            ],
        ),
        (
            "worried anxious",
            vec![
                "worry",
                "anxious",
                "nervous",
                "stress",
                "scared",
                "afraid",
                "panic",
                "concerned",
                "overwhelm",
                "anxiety",
            ],
        ),
        (
            "this weekend plans",
            vec![
                "weekend",
                "saturday",
                "sunday",
                "plan",
                "plans",
                "doing",
                "free",
                "busy",
                "hang",
            ],
        ),
        (
            "last night",
            vec![
                "night",
                "yesterday",
                "last night",
                "evening",
                "late",
                "sleep",
            ],
        ),
        (
            "tomorrow morning",
            vec![
                "tomorrow",
                "morning",
                "wake",
                "early",
                "alarm",
            ],
        ),
        (
            "party hangout",
            vec![
                "party",
                "hang",
                "hangout",
                "chill",
                "come over",
                "invite",
                "pregame",
                "bar",
                "club",
                "drinks",
            ],
        ),
        (
            "birthday",
            vec![
                "birthday",
                "bday",
                "born",
                "cake",
                "celebrate",
                "present",
                "gift",
                "old",
                "years",
            ],
        ),
        (
            "movie recommendation",
            vec![
                "movie",
                "film",
                "watch",
                "netflix",
                "show",
                "series",
                "recommend",
                "seen",
                "theater",
                "cinema",
            ],
        ),
        (
            "instagram link",
            vec![
                "instagram",
                "ig",
                "insta",
                "reel",
                "story",
                "post",
                "follow",
                "dm",
            ],
        ),
        (
            "youtube video",
            vec![
                "youtube",
                "youtu.be",
                "youtu",
                "video",
                "watch",
                "clip",
                "channel",
                "subscribe",
                "stream",
            ],
        ),
        (
            "photo picture",
            vec![
                "photo",
                "picture",
                "pic",
                "selfie",
                "image",
                "camera",
                "screenshot",
                "sent a photo",
            ],
        ),
        (
            "what should we do",
            vec!["should", "what", "idea", "decide", "plan", "option"],
        ),
        (
            "I was thinking",
            vec![
                "thinking",
                "thought",
                "think",
                "idea",
                "maybe",
                "wonder",
                "consider",
            ],
        ),
        (
            "do you remember",
            vec![
                "remember",
                "forgot",
                "recall",
                "memory",
                "time when",
                "that time",
            ],
        ),
        (
            "money finances",
            vec![
                "money",
                "pay",
                "paid",
                "cost",
                "price",
                "expensive",
                "cheap",
                "venmo",
                "cash",
                "dollar",
                "rent",
                "bill",
            ],
        ),
        (
            "fitness exercise",
            vec![
                "gym",
                "workout",
                "run",
                "lift",
                "exercise",
                "fit",
                "muscle",
                "training",
                "cardio",
                "health",
            ],
        ),
        (
            "music concert",
            vec![
                "music",
                "song",
                "concert",
                "spotify",
                "listen",
                "band",
                "album",
                "playlist",
                "tickets",
                "show",
            ],
        ),
        (
            "relationship dating",
            vec![
                "date",
                "dating",
                "relationship",
                "girlfriend",
                "boyfriend",
                "crush",
                "love",
                "tinder",
                "hinge",
                "breakup",
                "ex",
            ],
        ),
        (
            "sports game",
            vec![
                "game",
                "score",
                "win",
                "lost",
                "play",
                "team",
                "season",
                "football",
                "basketball",
                "soccer",
                "nfl",
                "nba",
            ],
        ),
        (
            "school class",
            vec![
                "class",
                "school",
                "homework",
                "study",
                "exam",
                "test",
                "professor",
                "lecture",
                "grade",
                "college",
                "university",
            ],
        ),
        (
            "apology sorry",
            vec![
                "sorry",
                "apologize",
                "apology",
                "forgive",
                "my bad",
                "fault",
                "mistake",
                "wrong",
            ],
        ),
        (
            "making plans",
            vec![
                "plan",
                "plans",
                "meet",
                "when",
                "where",
                "time",
                "down",
                "free",
                "busy",
                "schedule",
                "available",
            ],
        ),
        (
            "gratitude thankful",
            vec![
                "thank",
                "thanks",
                "appreciate",
                "grateful",
                "thx",
                "ty",
                "bless",
            ],
        ),
        (
            "complaining venting",
            vec![
                "complain",
                "vent",
                "annoying",
                "sucks",
                "worst",
                "tired",
                "sick of",
                "fed up",
                "can't stand",
                "unbearable",
            ],
        ),
        (
            "surprise unexpected",
            vec![
                "surprise",
                "unexpected",
                "omg",
                "what",
                "no way",
                "seriously",
                "wild",
                "crazy",
                "insane",
                "unbelievable",
            ],
        ),
        (
            "gaming video games",
            vec![
                "game",
                "gaming",
                "play",
                "playstation",
                "xbox",
                "pc",
                "steam",
                "fortnite",
                "valorant",
                "minecraft",
                "cod",
                "league",
            ],
        ),
        (
            "good morning greeting",
            vec![
                "good morning",
                "morning",
                "gm",
                "hey",
                "hi",
                "hello",
                "wassup",
                "sup",
                "yo",
                "what's up",
            ],
        ),
        (
            "good night sleep",
            vec![
                "good night",
                "night",
                "gn",
                "sleep",
                "bed",
                "tired",
                "sleepy",
                "nap",
                "dream",
            ],
        ),
    ];

    let query_lower = query.to_lowercase();
    for (pattern, synonyms) in &synonym_groups {
        if query_lower.contains(&pattern.to_lowercase())
            || pattern.to_lowercase().contains(&query_lower)
        {
            return synonyms
                .iter()
                .any(|syn| text_lower.contains(&syn.to_lowercase()));
        }
    }

    false
}

fn compute_score_stats(all_scores: &mut Vec<f32>) -> ScoreStats {
    all_scores.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

    let len = all_scores.len();
    let top5: Vec<f32> = all_scores.iter().take(5).copied().collect();
    let top10_mean = if len >= 10 {
        all_scores[..10].iter().sum::<f32>() / 10.0
    } else {
        all_scores.iter().sum::<f32>() / len as f32
    };
    let top20_mean = if len >= 20 {
        all_scores[..20].iter().sum::<f32>() / 20.0
    } else {
        all_scores.iter().sum::<f32>() / len as f32
    };

    let global_mean = all_scores.iter().sum::<f32>() / len as f32;
    let variance =
        all_scores.iter().map(|s| (s - global_mean).powi(2)).sum::<f32>() / len as f32;
    let global_std = variance.sqrt();

    let percentile_95 = all_scores[(len as f32 * 0.05) as usize];
    let percentile_90 = all_scores[(len as f32 * 0.10) as usize];
    let percentile_75 = all_scores[(len as f32 * 0.25) as usize];

    ScoreStats {
        top1: top5.first().copied().unwrap_or(0.0),
        top5_max: top5.first().copied().unwrap_or(0.0),
        top5_min: top5.last().copied().unwrap_or(0.0),
        top5_median: top5.get(2).copied().unwrap_or(0.0),
        top5_mean: top5.iter().sum::<f32>() / top5.len().max(1) as f32,
        top10_mean,
        top20_mean,
        global_mean,
        global_std,
        percentile_95,
        percentile_90,
        percentile_75,
    }
}

fn main() {
    let start_time = std::time::Instant::now();

    // ── Initialize ONNX Runtime ──────────────────────────────────────
    let ort_path = "/opt/homebrew/lib/libonnxruntime.dylib";
    eprintln!("[eval] Initializing ONNX Runtime from {ort_path}...");
    ort::init_from(ort_path)
        .expect("Failed to init ort")
        .commit();

    // ── Open analytics.db ────────────────────────────────────────────
    let home = dirs::home_dir().expect("No home dir");
    let analytics_db_path =
        home.join("Library/Application Support/com.icapsule.app/analytics.db");
    eprintln!("[eval] Opening analytics.db at {:?}...", analytics_db_path);
    let analytics_conn =
        Connection::open_with_flags(
            &analytics_db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("Failed to open analytics.db");

    // ── Load all chunk embeddings ────────────────────────────────────
    eprintln!("[eval] Loading all chunk embeddings...");
    let mut stmt = analytics_conn
        .prepare(
            "SELECT e.source_id, e.vector, mc.concatenated_text, mc.is_from_me, mc.message_count
             FROM embeddings e
             INNER JOIN message_chunks mc ON mc.id = e.source_id
             WHERE e.source_type = 'chunk'",
        )
        .expect("Failed to prepare query");

    let chunks: Vec<ChunkRecord> = stmt
        .query_map([], |row| {
            let chunk_id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            let text: String = row.get(2)?;
            let is_from_me: bool = row.get(3)?;
            let message_count: i64 = row.get(4)?;
            Ok((chunk_id, blob, text, is_from_me, message_count))
        })
        .expect("Query failed")
        .filter_map(|r| r.ok())
        .filter_map(|(chunk_id, blob, text, is_from_me, message_count)| {
            let vector = blob_to_embedding(&blob)?;
            Some(ChunkRecord {
                chunk_id,
                text,
                is_from_me,
                message_count,
                vector,
            })
        })
        .collect();

    eprintln!("[eval] Loaded {} chunk embeddings", chunks.len());

    // ── Compute chunk statistics ─────────────────────────────────────
    let text_lengths: Vec<usize> = chunks.iter().map(|c| c.text.len()).collect();
    let msg_counts: Vec<i64> = chunks.iter().map(|c| c.message_count).collect();
    let avg_text_len = text_lengths.iter().sum::<usize>() as f64 / chunks.len() as f64;
    let max_text_len = text_lengths.iter().max().unwrap_or(&0);
    let min_text_len = text_lengths.iter().min().unwrap_or(&0);
    let avg_msg_count = msg_counts.iter().sum::<i64>() as f64 / chunks.len() as f64;

    let mut sorted_lens = text_lengths.clone();
    sorted_lens.sort();
    let median_text_len = sorted_lens[sorted_lens.len() / 2];

    // Count length buckets
    let short_chunks = text_lengths.iter().filter(|&&l| l < 50).count();
    let medium_chunks = text_lengths.iter().filter(|&&l| l >= 50 && l < 200).count();
    let long_chunks = text_lengths.iter().filter(|&&l| l >= 200 && l < 500).count();
    let very_long_chunks = text_lengths.iter().filter(|&&l| l >= 500).count();

    eprintln!(
        "[eval] Chunk stats: avg_len={:.0}, median_len={}, min={}, max={}, avg_msgs={:.1}",
        avg_text_len, median_text_len, min_text_len, max_text_len, avg_msg_count
    );
    eprintln!(
        "[eval] Length distribution: <50={}, 50-200={}, 200-500={}, 500+={}",
        short_chunks, medium_chunks, long_chunks, very_long_chunks
    );

    // ── Load CLIP model ──────────────────────────────────────────────
    let models_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models");
    eprintln!("[eval] Loading text encoder...");
    let mut text_session = ort::session::Session::builder()
        .unwrap()
        .commit_from_file(models_dir.join("mobileclip_s2_text.onnx"))
        .expect("Failed to load text encoder");
    let tokenizer = tokenizers::Tokenizer::from_file(models_dir.join("tokenizer.json"))
        .expect("Failed to load tokenizer");
    eprintln!("[eval] Model loaded.");

    // ── Define test queries ──────────────────────────────────────────
    let queries: Vec<(&str, &str)> = vec![
        // Topical
        ("app development", "topical"),
        ("food restaurant", "topical"),
        ("travel plans", "topical"),
        ("work career", "topical"),
        ("money finances", "topical"),
        ("fitness exercise", "topical"),
        ("music concert", "topical"),
        ("school class", "topical"),
        ("gaming video games", "topical"),
        // Emotional
        ("happy excited", "emotional"),
        ("frustrated angry", "emotional"),
        ("sad missing", "emotional"),
        ("worried anxious", "emotional"),
        ("apology sorry", "emotional"),
        ("gratitude thankful", "emotional"),
        ("complaining venting", "emotional"),
        ("surprise unexpected", "emotional"),
        // Temporal
        ("this weekend plans", "temporal"),
        ("last night", "temporal"),
        ("tomorrow morning", "temporal"),
        // Social
        ("party hangout", "social"),
        ("birthday", "social"),
        ("movie recommendation", "social"),
        ("relationship dating", "social"),
        ("sports game", "social"),
        ("making plans", "social"),
        // Media
        ("instagram link", "media"),
        ("youtube video", "media"),
        ("photo picture", "media"),
        // Meta-conversation
        ("what should we do", "meta"),
        ("I was thinking", "meta"),
        ("do you remember", "meta"),
        // Greetings / daily
        ("good morning greeting", "daily"),
        ("good night sleep", "daily"),
    ];

    eprintln!("[eval] Running {} queries...", queries.len());

    // ── Run all queries ──────────────────────────────────────────────
    let mut results: Vec<QueryResult> = Vec::new();

    // Also collect data for cross-query analysis
    let mut all_top1_scores: Vec<(String, f32)> = Vec::new();
    let mut all_top5_relevance: Vec<(String, f32)> = Vec::new(); // (category, relevance_ratio)

    for (query, category) in &queries {
        eprint!("  Evaluating: {:<30}", query);

        let query_emb = match encode_query(&mut text_session, &tokenizer, query) {
            Some(e) => e,
            None => {
                eprintln!(" FAILED to encode");
                continue;
            }
        };

        // Score all chunks
        let mut scored: Vec<(f32, usize)> = chunks
            .iter()
            .enumerate()
            .map(|(idx, chunk)| {
                let score = cosine_similarity(&query_emb, &chunk.vector);
                (score, idx)
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // Top 5 detailed results
        let top_results: Vec<ScoredResult> = scored
            .iter()
            .take(5)
            .map(|&(score, idx)| {
                let chunk = &chunks[idx];
                ScoredResult {
                    score,
                    text: chunk.text.clone(),
                    text_len: chunk.text.len(),
                    message_count: chunk.message_count,
                    is_from_me: chunk.is_from_me,
                    has_keyword_overlap: check_relevance(query, &chunk.text),
                }
            })
            .collect();

        let relevance_hits = top_results.iter().filter(|r| r.has_keyword_overlap).count();

        // Score stats across all chunks
        let mut all_scores: Vec<f32> = scored.iter().map(|(s, _)| *s).collect();
        let score_stats = compute_score_stats(&mut all_scores);

        let relevance_ratio = relevance_hits as f32 / 5.0;
        all_top1_scores.push((category.to_string(), score_stats.top1));
        all_top5_relevance.push((category.to_string(), relevance_ratio));

        eprintln!(
            " top1={:.4}  rel={}/5  median_top5={:.4}",
            score_stats.top1, relevance_hits, score_stats.top5_median
        );

        results.push(QueryResult {
            query: query.to_string(),
            category: category.to_string(),
            top_results,
            score_stats,
            relevance_hits,
            relevance_total: 5,
        });
    }

    // ── Chunk-length vs score analysis ───────────────────────────────
    eprintln!("\n[eval] Analyzing chunk length vs score correlation...");

    // Pick a representative query and analyze score vs chunk length
    let analysis_query = "making plans";
    let analysis_emb = encode_query(&mut text_session, &tokenizer, analysis_query).unwrap();

    let mut length_score_pairs: Vec<(usize, f32)> = chunks
        .iter()
        .map(|c| {
            let score = cosine_similarity(&analysis_emb, &c.vector);
            (c.text.len(), score)
        })
        .collect();

    // Bin by length
    let length_bins: Vec<(&str, usize, usize)> = vec![
        ("0-20", 0, 20),
        ("21-50", 21, 50),
        ("51-100", 51, 100),
        ("101-200", 101, 200),
        ("201-500", 201, 500),
        ("500+", 500, usize::MAX),
    ];

    let mut length_analysis: Vec<(String, usize, f32, f32, f32)> = Vec::new();
    for (label, lo, hi) in &length_bins {
        let bin_scores: Vec<f32> = length_score_pairs
            .iter()
            .filter(|(len, _)| *len >= *lo && *len < *hi)
            .map(|(_, s)| *s)
            .collect();
        if !bin_scores.is_empty() {
            let count = bin_scores.len();
            let mean = bin_scores.iter().sum::<f32>() / count as f32;
            let max = bin_scores
                .iter()
                .copied()
                .reduce(f32::max)
                .unwrap_or(0.0);
            let min = bin_scores
                .iter()
                .copied()
                .reduce(f32::min)
                .unwrap_or(0.0);
            length_analysis.push((label.to_string(), count, mean, max, min));
        }
    }

    // ── Inter-query similarity analysis ──────────────────────────────
    eprintln!("[eval] Computing inter-query similarity matrix...");
    let mut query_embeddings: Vec<(String, [f32; EMBEDDING_DIM])> = Vec::new();
    for (query, _) in &queries {
        if let Some(emb) = encode_query(&mut text_session, &tokenizer, query) {
            query_embeddings.push((query.to_string(), emb));
        }
    }

    // Find most similar query pairs (potential confusion)
    let mut query_sims: Vec<(String, String, f32)> = Vec::new();
    for i in 0..query_embeddings.len() {
        for j in (i + 1)..query_embeddings.len() {
            let sim = cosine_similarity(&query_embeddings[i].1, &query_embeddings[j].1);
            query_sims.push((
                query_embeddings[i].0.clone(),
                query_embeddings[j].0.clone(),
                sim,
            ));
        }
    }
    query_sims.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // ── Score threshold analysis ─────────────────────────────────────
    eprintln!("[eval] Analyzing score thresholds...");

    // For each query, at various thresholds, compute precision and recall (how many relevant results survive)
    let thresholds: Vec<f32> = vec![0.60, 0.65, 0.70, 0.72, 0.75, 0.78, 0.80, 0.82, 0.85, 0.90];
    // For threshold analysis, we need to score more than top 5.
    // We'll re-compute using the stored all_query_scores.
    struct ThresholdQueryData {
        all_scores_sorted: Vec<(f32, bool)>, // (score, is_relevant) for top 50 results
    }
    let mut threshold_query_data: Vec<ThresholdQueryData> = Vec::new();

    // Re-encode queries and score top 50 for threshold analysis
    for (query, _category) in &queries {
        let query_emb = match encode_query(&mut text_session, &tokenizer, query) {
            Some(e) => e,
            None => continue,
        };
        let mut scored: Vec<(f32, usize)> = chunks
            .iter()
            .enumerate()
            .map(|(idx, chunk)| {
                let score = cosine_similarity(&query_emb, &chunk.vector);
                (score, idx)
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        let top50: Vec<(f32, bool)> = scored
            .iter()
            .take(50)
            .map(|&(score, idx)| {
                let is_rel = check_relevance(query, &chunks[idx].text);
                (score, is_rel)
            })
            .collect();
        threshold_query_data.push(ThresholdQueryData {
            all_scores_sorted: top50,
        });
    }

    let mut threshold_analysis: Vec<(f32, f32, f32, f32)> = Vec::new(); // (threshold, avg_surviving, avg_precision, pct_queries_with_results)

    for &threshold in &thresholds {
        let mut surviving_counts: Vec<usize> = Vec::new();
        let mut precision_values: Vec<f32> = Vec::new();
        let mut queries_with_results: usize = 0;

        for tqd in &threshold_query_data {
            let surviving: Vec<&(f32, bool)> = tqd
                .all_scores_sorted
                .iter()
                .filter(|(s, _)| *s >= threshold)
                .collect();
            surviving_counts.push(surviving.len());
            if !surviving.is_empty() {
                queries_with_results += 1;
                let precision = surviving.iter().filter(|(_, rel)| *rel).count() as f32
                    / surviving.len() as f32;
                precision_values.push(precision);
            }
        }

        let avg_surviving =
            surviving_counts.iter().sum::<usize>() as f32 / surviving_counts.len() as f32;
        let avg_precision = if !precision_values.is_empty() {
            precision_values.iter().sum::<f32>() / precision_values.len() as f32
        } else {
            0.0
        };
        let pct_with_results =
            queries_with_results as f32 / threshold_query_data.len() as f32 * 100.0;

        threshold_analysis.push((threshold, avg_surviving, avg_precision, pct_with_results));
    }

    // ── Write comprehensive results ──────────────────────────────────
    let output_path = "/tmp/search_quality_results.txt";
    eprintln!("\n[eval] Writing results to {output_path}...");
    let mut out = std::fs::File::create(output_path).expect("Failed to create output file");

    writeln!(out, "==========================================================================").unwrap();
    writeln!(out, "   SEMANTIC SEARCH QUALITY EVALUATION — MobileCLIP-S2 Text Encoder").unwrap();
    writeln!(out, "   Date: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")).unwrap();
    writeln!(out, "==========================================================================").unwrap();
    writeln!(out).unwrap();

    // ── Section 1: Dataset Overview ──────────────────────────────────
    writeln!(out, "1. DATASET OVERVIEW").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out, "  Total chunk embeddings:  {}", chunks.len()).unwrap();
    writeln!(out, "  Embedding dimension:     512 (MobileCLIP-S2)").unwrap();
    writeln!(out, "  Chat:                    Serb (chat_id=341)").unwrap();
    writeln!(out, "  Source messages:          ~10,000 most recent").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "  Chunk text length stats:").unwrap();
    writeln!(out, "    Mean:   {:.0} chars", avg_text_len).unwrap();
    writeln!(out, "    Median: {} chars", median_text_len).unwrap();
    writeln!(out, "    Min:    {} chars", min_text_len).unwrap();
    writeln!(out, "    Max:    {} chars", max_text_len).unwrap();
    writeln!(out, "    Avg messages/chunk: {:.1}", avg_msg_count).unwrap();
    writeln!(out).unwrap();
    writeln!(out, "  Length distribution:").unwrap();
    writeln!(out, "    <50 chars:    {:>5} chunks ({:.1}%)", short_chunks, short_chunks as f64 / chunks.len() as f64 * 100.0).unwrap();
    writeln!(out, "    50-200 chars: {:>5} chunks ({:.1}%)", medium_chunks, medium_chunks as f64 / chunks.len() as f64 * 100.0).unwrap();
    writeln!(out, "    200-500 chars:{:>5} chunks ({:.1}%)", long_chunks, long_chunks as f64 / chunks.len() as f64 * 100.0).unwrap();
    writeln!(out, "    500+ chars:   {:>5} chunks ({:.1}%)", very_long_chunks, very_long_chunks as f64 / chunks.len() as f64 * 100.0).unwrap();
    writeln!(out).unwrap();

    // ── Section 2: Per-Query Results ─────────────────────────────────
    writeln!(out, "2. PER-QUERY DETAILED RESULTS").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out).unwrap();

    let mut current_category = String::new();
    for result in &results {
        if result.category != current_category {
            current_category = result.category.clone();
            writeln!(out, "  ── {} ──", current_category.to_uppercase()).unwrap();
            writeln!(out).unwrap();
        }

        writeln!(
            out,
            "  Query: \"{}\"  [relevance: {}/{}]",
            result.query, result.relevance_hits, result.relevance_total
        )
        .unwrap();
        writeln!(
            out,
            "  Scores: top1={:.4}  top5_mean={:.4}  top5_range=[{:.4}, {:.4}]  global_mean={:.4}",
            result.score_stats.top1,
            result.score_stats.top5_mean,
            result.score_stats.top5_min,
            result.score_stats.top5_max,
            result.score_stats.global_mean
        )
        .unwrap();
        writeln!(
            out,
            "  Distribution: p95={:.4}  p90={:.4}  p75={:.4}  std={:.4}",
            result.score_stats.percentile_95,
            result.score_stats.percentile_90,
            result.score_stats.percentile_75,
            result.score_stats.global_std
        )
        .unwrap();

        for (i, r) in result.top_results.iter().enumerate() {
            let relevance_marker = if r.has_keyword_overlap { "Y" } else { "N" };
            let who = if r.is_from_me { "me" } else { "them" };
            let preview = if r.text.len() > 100 {
                format!("{}...", &r.text[..r.text.floor_char_boundary(100)])
            } else {
                r.text.clone()
            };
            // Replace newlines for cleaner output
            let preview = preview.replace('\n', " | ");
            writeln!(
                out,
                "    #{}: [{:.4}] [rel:{}] [{}] (len={}, msgs={}) {}",
                i + 1,
                r.score,
                relevance_marker,
                who,
                r.text_len,
                r.message_count,
                preview
            )
            .unwrap();
        }
        writeln!(out).unwrap();
    }

    // ── Section 3: Category Summary ──────────────────────────────────
    writeln!(out, "3. CATEGORY SUMMARY").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "  {:<20} {:>8} {:>10} {:>10} {:>10}",
        "Category", "Queries", "Avg Top1", "Avg Rel%", "Avg Top5"
    )
    .unwrap();
    writeln!(
        out,
        "  {:<20} {:>8} {:>10} {:>10} {:>10}",
        "--------", "-------", "--------", "--------", "--------"
    )
    .unwrap();

    let categories: Vec<&str> = vec![
        "topical",
        "emotional",
        "temporal",
        "social",
        "media",
        "meta",
        "daily",
    ];

    for cat in &categories {
        let cat_results: Vec<&QueryResult> =
            results.iter().filter(|r| r.category == *cat).collect();
        if cat_results.is_empty() {
            continue;
        }
        let count = cat_results.len();
        let avg_top1 =
            cat_results.iter().map(|r| r.score_stats.top1).sum::<f32>() / count as f32;
        let avg_rel = cat_results
            .iter()
            .map(|r| r.relevance_hits as f32 / r.relevance_total as f32 * 100.0)
            .sum::<f32>()
            / count as f32;
        let avg_top5 =
            cat_results.iter().map(|r| r.score_stats.top5_mean).sum::<f32>() / count as f32;

        writeln!(
            out,
            "  {:<20} {:>8} {:>9.4} {:>9.1}% {:>9.4}",
            cat, count, avg_top1, avg_rel, avg_top5
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    // Overall
    let overall_avg_top1 =
        results.iter().map(|r| r.score_stats.top1).sum::<f32>() / results.len() as f32;
    let overall_avg_rel = results
        .iter()
        .map(|r| r.relevance_hits as f32 / r.relevance_total as f32 * 100.0)
        .sum::<f32>()
        / results.len() as f32;
    let overall_avg_top5 =
        results.iter().map(|r| r.score_stats.top5_mean).sum::<f32>() / results.len() as f32;

    writeln!(
        out,
        "  {:<20} {:>8} {:>9.4} {:>9.1}% {:>9.4}",
        "OVERALL",
        results.len(),
        overall_avg_top1,
        overall_avg_rel,
        overall_avg_top5
    )
    .unwrap();
    writeln!(out).unwrap();

    // ── Section 4: Chunk Length vs Score Analysis ─────────────────────
    writeln!(out, "4. CHUNK LENGTH vs SCORE ANALYSIS (query: \"{}\")", analysis_query).unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "  {:<12} {:>8} {:>10} {:>10} {:>10}",
        "Length Bin", "Count", "Mean Score", "Max Score", "Min Score"
    )
    .unwrap();
    writeln!(
        out,
        "  {:<12} {:>8} {:>10} {:>10} {:>10}",
        "----------", "-----", "----------", "---------", "---------"
    )
    .unwrap();
    for (label, count, mean, max, min) in &length_analysis {
        writeln!(
            out,
            "  {:<12} {:>8} {:>10.4} {:>10.4} {:>10.4}",
            label, count, mean, max, min
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    // ── Section 5: Score Threshold Analysis ──────────────────────────
    writeln!(out, "5. SCORE THRESHOLD ANALYSIS").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out, "  For each threshold, shows avg results surviving (out of top 50),").unwrap();
    writeln!(out, "  precision (keyword-match rate among survivors), and % of queries with results.").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "  {:<12} {:>14} {:>14} {:>18}",
        "Threshold", "Avg Surviving", "Avg Precision", "Queries w/ Results"
    )
    .unwrap();
    writeln!(
        out,
        "  {:<12} {:>14} {:>14} {:>18}",
        "---------", "-------------", "-------------", "------------------"
    )
    .unwrap();
    for (threshold, avg_surv, avg_prec, pct) in &threshold_analysis {
        writeln!(
            out,
            "  {:<12.2} {:>14.2} {:>13.1}% {:>17.1}%",
            threshold, avg_surv, avg_prec * 100.0, pct
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    // ── Section 6: Inter-Query Similarity ────────────────────────────
    writeln!(out, "6. INTER-QUERY SIMILARITY (potential confusion pairs)").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out, "  Most similar query pairs (high similarity = model may confuse them):").unwrap();
    writeln!(out).unwrap();
    for (q1, q2, sim) in query_sims.iter().take(15) {
        writeln!(out, "    [{:.4}]  \"{}\"  <-->  \"{}\"", sim, q1, q2).unwrap();
    }
    writeln!(out).unwrap();
    writeln!(out, "  Most dissimilar query pairs:").unwrap();
    writeln!(out).unwrap();
    for (q1, q2, sim) in query_sims.iter().rev().take(10) {
        writeln!(out, "    [{:.4}]  \"{}\"  <-->  \"{}\"", sim, q1, q2).unwrap();
    }
    writeln!(out).unwrap();

    // ── Section 7: Failure Mode Analysis ─────────────────────────────
    writeln!(out, "7. FAILURE MODE ANALYSIS").unwrap();
    writeln!(out, "--------------------------------------------------------------------------").unwrap();
    writeln!(out).unwrap();

    // Queries where top results are clearly irrelevant (0 relevance hits in top 5)
    let total_failures: Vec<&QueryResult> =
        results.iter().filter(|r| r.relevance_hits == 0).collect();
    let partial_failures: Vec<&QueryResult> = results
        .iter()
        .filter(|r| r.relevance_hits > 0 && r.relevance_hits <= 2)
        .collect();
    let strong_results: Vec<&QueryResult> =
        results.iter().filter(|r| r.relevance_hits >= 4).collect();

    writeln!(
        out,
        "  Complete failures (0/5 relevance):  {} queries ({:.1}%)",
        total_failures.len(),
        total_failures.len() as f64 / results.len() as f64 * 100.0
    )
    .unwrap();
    for r in &total_failures {
        writeln!(
            out,
            "    - \"{}\" (top1={:.4}, category={})",
            r.query, r.score_stats.top1, r.category
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    writeln!(
        out,
        "  Partial failures (1-2/5 relevance): {} queries ({:.1}%)",
        partial_failures.len(),
        partial_failures.len() as f64 / results.len() as f64 * 100.0
    )
    .unwrap();
    for r in &partial_failures {
        writeln!(
            out,
            "    - \"{}\" (top1={:.4}, rel={}/5, category={})",
            r.query, r.score_stats.top1, r.relevance_hits, r.category
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    writeln!(
        out,
        "  Strong results (4-5/5 relevance):   {} queries ({:.1}%)",
        strong_results.len(),
        strong_results.len() as f64 / results.len() as f64 * 100.0
    )
    .unwrap();
    for r in &strong_results {
        writeln!(
            out,
            "    - \"{}\" (top1={:.4}, rel={}/5, category={})",
            r.query, r.score_stats.top1, r.relevance_hits, r.category
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    // Analyze what types of content CLIP handles well vs poorly
    writeln!(out, "  Content type performance:").unwrap();
    writeln!(out, "    CLIP (trained on image-text pairs) tends to:").unwrap();
    writeln!(out, "    - Handle well: concrete/visual topics (food, photos, places)").unwrap();
    writeln!(out, "    - Handle poorly: abstract emotions, temporal references, meta-conversation").unwrap();
    writeln!(out, "    - Be confused by: short chunks with few semantic signals").unwrap();
    writeln!(out).unwrap();

    // Identify score gap between relevant and irrelevant results
    let mut relevant_scores: Vec<f32> = Vec::new();
    let mut irrelevant_scores: Vec<f32> = Vec::new();
    for result in &results {
        for r in &result.top_results {
            if r.has_keyword_overlap {
                relevant_scores.push(r.score);
            } else {
                irrelevant_scores.push(r.score);
            }
        }
    }

    let avg_relevant = if !relevant_scores.is_empty() {
        relevant_scores.iter().sum::<f32>() / relevant_scores.len() as f32
    } else {
        0.0
    };
    let avg_irrelevant = if !irrelevant_scores.is_empty() {
        irrelevant_scores.iter().sum::<f32>() / irrelevant_scores.len() as f32
    } else {
        0.0
    };

    writeln!(
        out,
        "  Score separation between relevant and irrelevant results:"
    )
    .unwrap();
    writeln!(
        out,
        "    Avg score of relevant results (keyword match):     {:.4} (n={})",
        avg_relevant,
        relevant_scores.len()
    )
    .unwrap();
    writeln!(
        out,
        "    Avg score of irrelevant results (no keyword match): {:.4} (n={})",
        avg_irrelevant,
        irrelevant_scores.len()
    )
    .unwrap();
    writeln!(
        out,
        "    Gap: {:.4}",
        avg_relevant - avg_irrelevant
    )
    .unwrap();
    writeln!(out).unwrap();

    if avg_relevant - avg_irrelevant < 0.02 {
        writeln!(out, "    WARNING: Very small score gap between relevant and irrelevant results.").unwrap();
        writeln!(out, "    The model struggles to distinguish semantically related content from noise.").unwrap();
    } else if avg_relevant - avg_irrelevant < 0.05 {
        writeln!(out, "    NOTE: Moderate score gap. Re-ranking with keyword overlap would help significantly.").unwrap();
    } else {
        writeln!(out, "    Good score separation. Pure embedding similarity is reasonably discriminative.").unwrap();
    }
    writeln!(out).unwrap();

    // ── Section 8: Recommendations ───────────────────────────────────
    writeln!(out, "8. ACTIONABLE RECOMMENDATIONS").unwrap();
    writeln!(out, "==========================================================================").unwrap();
    writeln!(out).unwrap();

    // Determine optimal threshold
    let best_threshold = threshold_analysis
        .iter()
        .filter(|(_, _, _, pct)| *pct >= 80.0) // At least 80% of queries have results
        .max_by(|(_, _, prec_a, _), (_, _, prec_b, _)| {
            prec_a.partial_cmp(prec_b).unwrap_or(std::cmp::Ordering::Equal)
        });

    writeln!(out, "  A) MINIMUM SCORE THRESHOLD").unwrap();
    if let Some((threshold, avg_surv, avg_prec, pct)) = best_threshold {
        writeln!(
            out,
            "     Recommended threshold: {:.2}",
            threshold
        )
        .unwrap();
        writeln!(
            out,
            "     At this threshold: {:.1} avg results/query, {:.1}% precision, {:.1}% queries have results",
            avg_surv, avg_prec * 100.0, pct
        )
        .unwrap();
    } else {
        writeln!(out, "     No threshold achieves 80% query coverage with good precision.").unwrap();
        writeln!(out, "     Consider using a very low threshold (0.15) and relying on re-ranking.").unwrap();
    }
    writeln!(out).unwrap();

    writeln!(out, "  B) HYBRID RE-RANKING").unwrap();
    let gap = avg_relevant - avg_irrelevant;
    if gap < 0.03 {
        writeln!(out, "     STRONGLY RECOMMENDED: The embedding similarity gap between relevant").unwrap();
        writeln!(out, "     and irrelevant results is only {:.4}. A hybrid approach combining", gap).unwrap();
        writeln!(out, "     embedding similarity with keyword/BM25 matching would significantly").unwrap();
        writeln!(out, "     improve result quality.").unwrap();
        writeln!(out).unwrap();
        writeln!(out, "     Suggested formula:").unwrap();
        writeln!(out, "       final_score = 0.6 * clip_score + 0.4 * keyword_score").unwrap();
        writeln!(out, "     Where keyword_score uses TF-IDF or BM25 on the chunk text.").unwrap();
    } else {
        writeln!(out, "     RECOMMENDED: Re-ranking with keyword matching would help for").unwrap();
        writeln!(out, "     queries where CLIP struggles (abstract/emotional/temporal).").unwrap();
        writeln!(out, "     Suggested formula:").unwrap();
        writeln!(out, "       final_score = 0.7 * clip_score + 0.3 * keyword_score").unwrap();
    }
    writeln!(out).unwrap();

    writeln!(out, "  C) ALTERNATIVE MODELS").unwrap();
    writeln!(out, "     MobileCLIP-S2 is a vision-language model trained on image-text pairs.").unwrap();
    writeln!(out, "     For text-to-text semantic search on conversational messages, consider:").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "     1. all-MiniLM-L6-v2 (384-dim, 80MB)").unwrap();
    writeln!(out, "        - Trained on semantic textual similarity").unwrap();
    writeln!(out, "        - Much better for conversational text matching").unwrap();
    writeln!(out, "        - Available as ONNX, same inference pipeline would work").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "     2. BAAI/bge-small-en-v1.5 (384-dim, 130MB)").unwrap();
    writeln!(out, "        - State-of-the-art for retrieval tasks").unwrap();
    writeln!(out, "        - Much better at understanding query intent").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "     3. Keep MobileCLIP for image search (cross-modal) but add a").unwrap();
    writeln!(out, "        dedicated text embedding model for message search.").unwrap();
    writeln!(out, "        This dual-model approach gives best of both worlds.").unwrap();
    writeln!(out).unwrap();

    writeln!(out, "  D) OPTIMAL CHUNK LENGTH").unwrap();
    writeln!(out, "     Based on length-vs-score analysis:").unwrap();
    for (label, count, mean, max, _min) in &length_analysis {
        writeln!(
            out,
            "       {:<12}: n={:>5}, mean_score={:.4}, max_score={:.4}",
            label, count, mean, max
        )
        .unwrap();
    }
    writeln!(out).unwrap();

    // Find the best-performing length bin
    if let Some(best_bin) = length_analysis
        .iter()
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
    {
        writeln!(
            out,
            "     Best-performing length range: {} (mean_score={:.4})",
            best_bin.0, best_bin.2
        )
        .unwrap();
    }

    writeln!(out).unwrap();
    writeln!(out, "     Recommendations for chunking:").unwrap();
    writeln!(out, "     - Very short chunks (<20 chars) carry too little semantic signal").unwrap();
    writeln!(out, "     - Target 50-300 character chunks for best CLIP performance").unwrap();
    writeln!(out, "     - Consider overlapping chunks to capture context at boundaries").unwrap();
    writeln!(out, "     - Current sender-based chunking is reasonable but consider").unwrap();
    writeln!(out, "       also creating conversation-turn chunks (question + reply)").unwrap();
    writeln!(out).unwrap();

    writeln!(out, "  E) ADDITIONAL IMPROVEMENTS").unwrap();
    writeln!(out, "     1. Query expansion: For short queries, expand with synonyms before encoding").unwrap();
    writeln!(out, "     2. Result diversification: Avoid showing 5 chunks from the same time window").unwrap();
    writeln!(out, "     3. Temporal boosting: Boost recent messages slightly for temporal queries").unwrap();
    writeln!(out, "     4. Confidence indicator: Show score as a relevance percentage to users,").unwrap();
    writeln!(out, "        hiding results below the threshold rather than showing low-confidence ones").unwrap();
    writeln!(out, "     5. Negative feedback loop: Allow users to mark irrelevant results to").unwrap();
    writeln!(out, "        learn per-user score calibration over time").unwrap();
    writeln!(out).unwrap();

    // ── Summary ──────────────────────────────────────────────────────
    writeln!(out, "9. EXECUTIVE SUMMARY").unwrap();
    writeln!(out, "==========================================================================").unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "  Total queries evaluated: {}",
        results.len()
    )
    .unwrap();
    writeln!(
        out,
        "  Overall avg top-1 score: {:.4}",
        overall_avg_top1
    )
    .unwrap();
    writeln!(
        out,
        "  Overall avg relevance:   {:.1}% (keyword-match heuristic in top 5)",
        overall_avg_rel
    )
    .unwrap();
    writeln!(
        out,
        "  Score gap (relevant vs irrelevant): {:.4}",
        gap
    )
    .unwrap();
    writeln!(out).unwrap();

    if overall_avg_rel < 30.0 {
        writeln!(out, "  VERDICT: Search quality is POOR for text-to-text retrieval.").unwrap();
        writeln!(out, "  MobileCLIP is a vision-language model and struggles with conversational").unwrap();
        writeln!(out, "  text matching. The primary recommendation is to add a dedicated text").unwrap();
        writeln!(out, "  embedding model (all-MiniLM-L6-v2 or BGE) while keeping MobileCLIP").unwrap();
        writeln!(out, "  for cross-modal image search.").unwrap();
    } else if overall_avg_rel < 50.0 {
        writeln!(out, "  VERDICT: Search quality is FAIR but inconsistent.").unwrap();
        writeln!(out, "  Works reasonably for concrete topics but fails on abstract/emotional queries.").unwrap();
        writeln!(out, "  Hybrid re-ranking with keyword matching is the highest-impact improvement.").unwrap();
        writeln!(out, "  A dedicated text model would further improve quality significantly.").unwrap();
    } else {
        writeln!(out, "  VERDICT: Search quality is ACCEPTABLE.").unwrap();
        writeln!(out, "  Results are generally relevant, especially for topical queries.").unwrap();
        writeln!(out, "  Hybrid re-ranking would provide incremental improvement.").unwrap();
    }
    writeln!(out).unwrap();

    let elapsed = start_time.elapsed();
    writeln!(
        out,
        "  Evaluation completed in {:.1}s",
        elapsed.as_secs_f64()
    )
    .unwrap();
    writeln!(out, "==========================================================================").unwrap();

    eprintln!(
        "\n[eval] Done! Results written to {}  ({:.1}s)",
        output_path,
        elapsed.as_secs_f64()
    );
}

/// Parse the NSArchiver binary blob (`attributedBody`) to extract plain text.
///
/// When `message.text` is NULL (macOS Ventura+), the text lives inside
/// `attributedBody`, an NSKeyedArchiver plist blob. We look for the byte
/// pattern `0x84 0x01 0x2B` which precedes the raw UTF-8 string, then read
/// the length and extract the text.
pub fn extract_text_from_attributed_body(blob: &[u8]) -> Option<String> {
    // Locate the marker sequence 0x84 0x01 0x2B.
    let marker: &[u8] = &[0x84, 0x01, 0x2B];

    let pos = blob.windows(marker.len()).position(|w| w == marker)?;
    let after_marker = pos + marker.len();

    if after_marker >= blob.len() {
        return None;
    }

    // The next bytes encode the string length.
    // If the first byte has its high bit set, it encodes a multi-byte length.
    let (str_len, data_start) = read_length(&blob[after_marker..])?;

    if str_len == 0 {
        return None;
    }

    let start = after_marker + data_start;
    let end = start + str_len;

    if end > blob.len() {
        return None;
    }

    let text = std::str::from_utf8(&blob[start..end]).ok()?;
    let trimmed = text.trim().to_string();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Read a variable-length integer from the blob.
/// Returns (value, bytes_consumed).
fn read_length(data: &[u8]) -> Option<(usize, usize)> {
    if data.is_empty() {
        return None;
    }

    let first = data[0] as usize;

    // Single-byte length
    if first & 0x80 == 0 {
        return Some((first, 1));
    }

    // Multi-byte length: low 7 bits tell how many following bytes encode the length.
    let num_bytes = first & 0x7F;
    if num_bytes == 0 || num_bytes > 4 {
        return None;
    }
    if data.len() < 1 + num_bytes {
        return None;
    }

    let mut value: usize = 0;
    for i in 0..num_bytes {
        value = (value << 8) | (data[1 + i] as usize);
    }

    Some((value, 1 + num_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_simple_text() {
        // Build a fake blob with the marker + a short string.
        let text = "Hello, world!";
        let mut blob = vec![0x00, 0x00]; // some leading bytes
        blob.extend_from_slice(&[0x84, 0x01, 0x2B]); // marker
        blob.push(text.len() as u8); // single-byte length
        blob.extend_from_slice(text.as_bytes());
        blob.extend_from_slice(&[0x00, 0x00]); // trailing junk

        let result = extract_text_from_attributed_body(&blob);
        assert_eq!(result, Some("Hello, world!".to_string()));
    }

    #[test]
    fn test_no_marker() {
        let blob = vec![0x00, 0x01, 0x02, 0x03];
        assert_eq!(extract_text_from_attributed_body(&blob), None);
    }
}

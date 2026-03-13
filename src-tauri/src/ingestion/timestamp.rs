/// Apple Core Data epoch: 2001-01-01 00:00:00 UTC, expressed in Unix seconds.
const APPLE_EPOCH_OFFSET_SECS: i64 = 978_307_200;

/// Threshold to distinguish nanosecond timestamps (macOS Ventura+) from
/// second-precision timestamps (older macOS).
const NANO_THRESHOLD: i64 = 1_000_000_000;

/// Convert an Apple Core Data timestamp to Unix milliseconds.
///
/// Apple stores timestamps in two formats:
/// - **Nanoseconds since 2001-01-01** (modern, > 1 billion)
/// - **Seconds since 2001-01-01** (legacy)
///
/// This function detects the format and returns Unix milliseconds.
pub fn apple_timestamp_to_unix_ms(ts: i64) -> i64 {
    if ts == 0 {
        return 0;
    }
    if ts > NANO_THRESHOLD {
        // Nanosecond precision → convert to ms and shift epoch
        (ts / 1_000_000) + (APPLE_EPOCH_OFFSET_SECS * 1_000)
    } else {
        // Second precision → shift epoch and convert to ms
        // Use saturating arithmetic to handle corrupt/sentinel values
        (ts.saturating_add(APPLE_EPOCH_OFFSET_SECS)).saturating_mul(1_000)
    }
}

/// Convert Unix milliseconds to Apple nanosecond timestamp.
pub fn unix_ms_to_apple_timestamp(unix_ms: i64) -> i64 {
    if unix_ms == 0 {
        return 0;
    }
    (unix_ms - (APPLE_EPOCH_OFFSET_SECS * 1_000)) * 1_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nano_timestamp() {
        // 2024-01-15 roughly
        let apple_ns: i64 = 726_969_600_000_000_000;
        let unix_ms = apple_timestamp_to_unix_ms(apple_ns);
        // Should be somewhere around Jan 2024 in Unix ms
        assert!(unix_ms > 1_700_000_000_000);
        assert!(unix_ms < 1_800_000_000_000);
    }

    #[test]
    fn test_second_timestamp() {
        // 0 seconds since Apple epoch = 2001-01-01
        let unix_ms = apple_timestamp_to_unix_ms(0);
        assert_eq!(unix_ms, 0); // special-cased to 0
    }

    #[test]
    fn test_roundtrip() {
        let original_ns: i64 = 726_969_600_000_000_000;
        let unix_ms = apple_timestamp_to_unix_ms(original_ns);
        let back = unix_ms_to_apple_timestamp(unix_ms);
        // Should be within 1ms (since we lose sub-ms precision)
        assert!((back - original_ns).abs() < 1_000_000);
    }
}

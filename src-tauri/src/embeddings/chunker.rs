use crate::db::models::Message;

/// A chunk of consecutive messages from the same sender within a conversation.
///
/// Messages are grouped into chunks by sender identity (is_from_me + handle_id),
/// chat membership, and temporal proximity (5-minute gap threshold).
pub struct MessageChunk {
    pub chat_id: i64,
    pub is_from_me: bool,
    pub handle_id: Option<i64>,
    pub first_rowid: i64,
    pub last_rowid: i64,
    pub message_count: i64,
    pub concatenated_text: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub message_rowids: Vec<i64>,
}

/// Maximum time gap (in milliseconds) between consecutive same-sender messages
/// before a new chunk is started.
const GAP_THRESHOLD_MS: i64 = 5 * 60 * 1000; // 5 minutes

/// Group a chronologically-ordered slice of messages into chunks.
///
/// A new chunk starts when any of the following occurs:
/// 1. The sender changes (different `is_from_me` or different `handle_id`)
/// 2. The time gap between consecutive same-sender messages exceeds 5 minutes
/// 3. The chat changes (different `chat_id`)
///
/// Messages with `None` text are included in the chunk (counted and tracked by rowid)
/// but do not contribute text. If every message in a chunk has `None` text, the chunk
/// is still emitted with an empty `concatenated_text`.
pub fn chunk_messages(messages: &[Message]) -> Vec<MessageChunk> {
    if messages.is_empty() {
        return vec![];
    }

    let mut chunks: Vec<MessageChunk> = Vec::new();

    // Initialize with the first message
    let first = &messages[0];
    let mut current = MessageChunk {
        chat_id: first.chat_id.unwrap_or(0),
        is_from_me: first.is_from_me,
        handle_id: if first.is_from_me {
            None
        } else {
            Some(first.handle_id)
        },
        first_rowid: first.rowid,
        last_rowid: first.rowid,
        message_count: 1,
        concatenated_text: first.text.clone().unwrap_or_default(),
        started_at: first.date,
        ended_at: first.date,
        message_rowids: vec![first.rowid],
    };

    for msg in &messages[1..] {
        let msg_chat_id = msg.chat_id.unwrap_or(0);
        let msg_handle = if msg.is_from_me {
            None
        } else {
            Some(msg.handle_id)
        };

        let sender_changed = msg.is_from_me != current.is_from_me || msg_handle != current.handle_id;
        let chat_changed = msg_chat_id != current.chat_id;
        let time_diff = (msg.date as i128 - current.ended_at as i128).unsigned_abs();
        let time_gap = time_diff > GAP_THRESHOLD_MS as u128;

        if sender_changed || chat_changed || time_gap {
            // Finalize the current chunk and start a new one
            chunks.push(current);
            current = MessageChunk {
                chat_id: msg_chat_id,
                is_from_me: msg.is_from_me,
                handle_id: msg_handle,
                first_rowid: msg.rowid,
                last_rowid: msg.rowid,
                message_count: 1,
                concatenated_text: msg.text.clone().unwrap_or_default(),
                started_at: msg.date,
                ended_at: msg.date,
                message_rowids: vec![msg.rowid],
            };
        } else {
            // Extend the current chunk
            current.last_rowid = msg.rowid;
            current.message_count += 1;
            current.ended_at = msg.date;
            current.message_rowids.push(msg.rowid);
            if let Some(ref text) = msg.text {
                if !current.concatenated_text.is_empty() {
                    current.concatenated_text.push(' ');
                }
                current.concatenated_text.push_str(text);
            }
        }
    }

    // Don't forget the last chunk
    chunks.push(current);

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Message;

    fn make_message(
        rowid: i64,
        text: Option<&str>,
        is_from_me: bool,
        date: i64,
        handle_id: i64,
        chat_id: Option<i64>,
    ) -> Message {
        Message {
            rowid,
            guid: format!("guid-{rowid}"),
            text: text.map(|s| s.to_string()),
            is_from_me,
            date,
            date_read: None,
            date_delivered: None,
            handle_id,
            sender: None,
            sender_display_name: None,
            service: None,
            associated_message_type: 0,
            associated_message_guid: None,
            cache_has_attachments: false,
            thread_originator_guid: None,
            group_title: None,
            is_audio_message: false,
            chat_id,
        }
    }

    #[test]
    fn test_empty_input() {
        assert!(chunk_messages(&[]).is_empty());
    }

    #[test]
    fn test_single_message() {
        let msgs = vec![make_message(1, Some("hello"), false, 1000, 5, Some(1))];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].message_count, 1);
        assert_eq!(chunks[0].concatenated_text, "hello");
        assert_eq!(chunks[0].first_rowid, 1);
        assert_eq!(chunks[0].last_rowid, 1);
    }

    #[test]
    fn test_same_sender_within_threshold() {
        let msgs = vec![
            make_message(1, Some("hello"), false, 1000, 5, Some(1)),
            make_message(2, Some("world"), false, 2000, 5, Some(1)),
            make_message(3, Some("!"), false, 3000, 5, Some(1)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].message_count, 3);
        assert_eq!(chunks[0].concatenated_text, "hello world !");
        assert_eq!(chunks[0].message_rowids, vec![1, 2, 3]);
    }

    #[test]
    fn test_sender_change_splits_chunk() {
        let msgs = vec![
            make_message(1, Some("hi"), false, 1000, 5, Some(1)),
            make_message(2, Some("hey"), true, 2000, 0, Some(1)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].concatenated_text, "hi");
        assert!(!chunks[0].is_from_me);
        assert_eq!(chunks[1].concatenated_text, "hey");
        assert!(chunks[1].is_from_me);
    }

    #[test]
    fn test_time_gap_splits_chunk() {
        let gap = GAP_THRESHOLD_MS + 1;
        let msgs = vec![
            make_message(1, Some("first"), false, 1000, 5, Some(1)),
            make_message(2, Some("second"), false, 1000 + gap, 5, Some(1)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 2);
    }

    #[test]
    fn test_chat_change_splits_chunk() {
        let msgs = vec![
            make_message(1, Some("in chat 1"), false, 1000, 5, Some(1)),
            make_message(2, Some("in chat 2"), false, 2000, 5, Some(2)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].chat_id, 1);
        assert_eq!(chunks[1].chat_id, 2);
    }

    #[test]
    fn test_none_text_messages_included() {
        let msgs = vec![
            make_message(1, Some("hello"), false, 1000, 5, Some(1)),
            make_message(2, None, false, 2000, 5, Some(1)),
            make_message(3, Some("world"), false, 3000, 5, Some(1)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].message_count, 3);
        assert_eq!(chunks[0].concatenated_text, "hello world");
        assert_eq!(chunks[0].message_rowids, vec![1, 2, 3]);
    }

    #[test]
    fn test_all_none_text_produces_empty_string() {
        let msgs = vec![
            make_message(1, None, false, 1000, 5, Some(1)),
            make_message(2, None, false, 2000, 5, Some(1)),
        ];
        let chunks = chunk_messages(&msgs);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].message_count, 2);
        assert_eq!(chunks[0].concatenated_text, "");
    }
}

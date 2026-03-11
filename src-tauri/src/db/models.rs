use serde::Serialize;

use crate::ingestion::timestamp::apple_timestamp_to_unix_ms;

/// A chat conversation (1:1 or group)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub rowid: i64,
    pub guid: String,
    pub display_name: Option<String>,
    pub chat_identifier: String,
    pub service_name: Option<String>,
    /// 43 = group, 45 = DM
    pub style: i64,
    pub participants: Vec<Handle>,
    pub last_message_date: Option<i64>,
    pub last_message_text: Option<String>,
}

/// A single iMessage/SMS message
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub rowid: i64,
    pub guid: String,
    pub text: Option<String>,
    pub is_from_me: bool,
    /// Unix milliseconds
    pub date: i64,
    pub date_read: Option<i64>,
    pub date_delivered: Option<i64>,
    pub handle_id: i64,
    pub sender: Option<String>,
    pub sender_display_name: Option<String>,
    pub service: Option<String>,
    pub associated_message_type: i64,
    pub associated_message_guid: Option<String>,
    pub cache_has_attachments: bool,
    pub thread_originator_guid: Option<String>,
    pub group_title: Option<String>,
    pub is_audio_message: bool,
    pub chat_id: Option<i64>,
}

/// A file attachment linked to a message
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub rowid: i64,
    pub guid: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub uti: Option<String>,
    pub transfer_name: Option<String>,
    pub total_bytes: i64,
    pub is_outgoing: bool,
    pub message_id: i64,
}

/// A handle (phone number or email address)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handle {
    pub rowid: i64,
    pub id: String,
    pub service: String,
    pub person_centric_id: Option<String>,
    pub display_name: Option<String>,
}

/// Raw row coming from SQLite before timestamp conversion.
/// Used internally; not serialized to the frontend.
pub(crate) struct RawMessageRow {
    pub rowid: i64,
    pub guid: String,
    pub text: Option<String>,
    pub attributed_body: Option<Vec<u8>>,
    pub is_from_me: i64,
    pub date: i64,
    pub date_read: i64,
    pub date_delivered: i64,
    pub handle_id: i64,
    pub service: Option<String>,
    pub associated_message_type: i64,
    pub associated_message_guid: Option<String>,
    pub cache_has_attachments: i64,
    pub thread_originator_guid: Option<String>,
    pub group_title: Option<String>,
    pub is_audio_message: i64,
    pub chat_id: Option<i64>,
}

impl RawMessageRow {
    /// Resolve the text field: if text is None, attempt to parse the attributedBody blob.
    fn resolve_text(&self) -> Option<String> {
        if let Some(ref t) = self.text {
            // Strip U+FFFC / U+FFFD object-replacement characters
            let cleaned: String = t.chars().filter(|c| *c != '\u{FFFC}' && *c != '\u{FFFD}').collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        } else {
            self.attributed_body
                .as_ref()
                .and_then(|blob| crate::ingestion::message_parser::extract_text_from_attributed_body(blob))
        }
    }

    pub fn into_message(self, sender: Option<String>, sender_display_name: Option<String>) -> Message {
        let text = self.resolve_text();
        Message {
            rowid: self.rowid,
            guid: self.guid,
            text,
            is_from_me: self.is_from_me != 0,
            date: apple_timestamp_to_unix_ms(self.date),
            date_read: if self.date_read != 0 {
                Some(apple_timestamp_to_unix_ms(self.date_read))
            } else {
                None
            },
            date_delivered: if self.date_delivered != 0 {
                Some(apple_timestamp_to_unix_ms(self.date_delivered))
            } else {
                None
            },
            handle_id: self.handle_id,
            sender,
            sender_display_name,
            service: self.service,
            associated_message_type: self.associated_message_type,
            associated_message_guid: self.associated_message_guid,
            cache_has_attachments: self.cache_has_attachments != 0,
            thread_originator_guid: self.thread_originator_guid,
            group_title: self.group_title,
            is_audio_message: self.is_audio_message != 0,
            chat_id: self.chat_id,
        }
    }
}

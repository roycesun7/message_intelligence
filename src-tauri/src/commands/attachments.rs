use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::db::chat_db;
use crate::error::AppResult;
use crate::state::AppState;

/// Attachment data returned to the frontend.
/// For image types, `data_url` contains a base64-encoded data URL.
/// For other types, `data_url` is None — only metadata is returned.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    pub rowid: i64,
    pub guid: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub uti: Option<String>,
    pub transfer_name: Option<String>,
    pub total_bytes: i64,
    pub is_outgoing: bool,
    /// base64-encoded data URL (e.g. "data:image/jpeg;base64,...") for image attachments.
    /// None for non-image types or if the file cannot be read.
    pub data_url: Option<String>,
}

/// Maximum file size we'll base64-encode (10 MB).
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// MIME types we treat as inline-renderable images.
/// Note: HEIC/HEIF excluded — base64 data URLs for these formats are not
/// reliably rendered by WebKit's <img> element. They'll show as file cards.
fn is_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp"
            | "image/tiff"
            | "image/bmp"
    )
}

/// Expand `~` at the start of a path to the user's home directory.
fn expand_tilde(path: &str) -> Option<std::path::PathBuf> {
    if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir().map(|home| home.join(rest))
    } else if path == "~" {
        dirs::home_dir()
    } else {
        Some(std::path::PathBuf::from(path))
    }
}

/// Read an attachment file and base64-encode it as a data URL.
fn read_image_as_data_url(filename: &str, mime_type: &str) -> Option<String> {
    let path = expand_tilde(filename)?;

    if !path.exists() {
        log::debug!("Attachment file not found: {}", path.display());
        return None;
    }

    let metadata = std::fs::metadata(&path).ok()?;
    if metadata.len() > MAX_IMAGE_SIZE {
        log::debug!(
            "Attachment too large to inline ({} bytes): {}",
            metadata.len(),
            path.display()
        );
        return None;
    }

    let bytes = std::fs::read(&path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime_type, b64))
}

/// Fetch attachment data for a given message.
/// Images are base64-encoded and returned as data URLs.
/// Non-image attachments return metadata only.
#[tauri::command]
pub fn get_attachment_data(
    state: State<'_, AppState>,
    message_id: i64,
) -> AppResult<Vec<AttachmentData>> {
    let conn = state.lock_chat_db()?;

    let attachments = chat_db::get_attachments_for_message(&conn, message_id)?;

    let results: Vec<AttachmentData> = attachments
        .into_iter()
        .map(|a| {
            let data_url = match (&a.filename, &a.mime_type) {
                (Some(fname), Some(mime)) if is_image_mime(mime) => {
                    read_image_as_data_url(fname, mime)
                }
                _ => None,
            };

            AttachmentData {
                rowid: a.rowid,
                guid: a.guid,
                filename: a.filename,
                mime_type: a.mime_type,
                uti: a.uti,
                transfer_name: a.transfer_name,
                total_bytes: a.total_bytes,
                is_outgoing: a.is_outgoing,
                data_url,
            }
        })
        .collect();

    Ok(results)
}

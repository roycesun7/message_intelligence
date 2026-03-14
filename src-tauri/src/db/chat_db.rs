use rusqlite::{params, Connection};
use std::collections::HashMap;

use crate::db::contacts_db;
use crate::db::models::{Attachment, Chat, Handle, Message, RawMessageRow};
use crate::error::AppResult;
use crate::ingestion::timestamp::apple_timestamp_to_unix_ms;

pub fn get_chat_list(conn: &Connection, contact_map: &HashMap<String, String>) -> AppResult<Vec<Chat>> {
    let mut stmt = conn.prepare(
        "SELECT
            c.ROWID        AS chat_id,
            c.guid         AS chat_guid,
            c.display_name,
            c.chat_identifier,
            c.service_name,
            c.style,
            m.date         AS latest_message_date,
            m.text,
            m.attributedBody
         FROM chat AS c
         INNER JOIN message AS m ON m.ROWID = (
             SELECT cmj2.message_id
             FROM chat_message_join AS cmj2
             WHERE cmj2.chat_id = c.ROWID
             ORDER BY cmj2.message_date DESC
             LIMIT 1
         )
         ORDER BY m.date DESC",
    )?;

    struct ChatRow {
        chat_id: i64,
        chat_guid: String,
        display_name: Option<String>,
        chat_identifier: String,
        service_name: Option<String>,
        style: i64,
        latest_message_date: i64,
        text: Option<String>,
        attributed_body: Option<Vec<u8>>,
    }

    let chat_rows: Vec<ChatRow> = stmt
        .query_map([], |row| {
            Ok(ChatRow {
                chat_id: row.get(0)?,
                chat_guid: row.get(1)?,
                display_name: row.get(2)?,
                chat_identifier: row.get(3)?,
                service_name: row.get(4)?,
                style: row.get(5)?,
                latest_message_date: row.get(6)?,
                text: row.get(7)?,
                attributed_body: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut handle_stmt = conn.prepare(
        "SELECT h.ROWID, h.id, h.service, h.person_centric_id, chj.chat_id
         FROM handle AS h
         LEFT JOIN chat_handle_join AS chj ON h.ROWID = chj.handle_id",
    )?;

    let mut handles_by_chat: HashMap<i64, Vec<Handle>> = HashMap::new();

    handle_stmt
        .query_map([], |row| {
            let id: String = row.get(1)?;
            let handle = Handle {
                rowid: row.get(0)?,
                id: id.clone(),
                service: row.get(2)?,
                person_centric_id: row.get(3)?,
                display_name: None,
            };
            let chat_id: Option<i64> = row.get(4)?;
            Ok((handle, chat_id))
        })?
        .filter_map(|r| r.ok())
        .for_each(|(mut handle, chat_id)| {
            handle.display_name = contacts_db::resolve_name(&handle.id, contact_map);
            if let Some(cid) = chat_id {
                handles_by_chat.entry(cid).or_default().push(handle);
            }
        });

    let chats = chat_rows
        .into_iter()
        .map(|cr| {
            let last_text = if let Some(t) = cr.text {
                let cleaned: String = t.chars().filter(|c| *c != '\u{FFFC}' && *c != '\u{FFFD}').collect();
                if cleaned.is_empty() { None } else { Some(cleaned) }
            } else {
                cr.attributed_body
                    .as_ref()
                    .and_then(|blob| crate::ingestion::message_parser::extract_text_from_attributed_body(blob))
            };
            let participants = handles_by_chat.remove(&cr.chat_id).unwrap_or_default();
            Chat {
                rowid: cr.chat_id,
                guid: cr.chat_guid,
                display_name: cr.display_name,
                chat_identifier: cr.chat_identifier,
                service_name: cr.service_name,
                style: cr.style,
                participants,
                last_message_date: Some(apple_timestamp_to_unix_ms(cr.latest_message_date)),
                last_message_text: last_text,
            }
        })
        .collect();

    Ok(chats)
}

pub fn get_messages_for_chat(
    conn: &Connection,
    chat_id: i64,
    limit: i64,
    offset: i64,
    contact_map: &HashMap<String, String>,
) -> AppResult<Vec<Message>> {
    let handle_map = build_handle_map(conn)?;

    let mut stmt = conn.prepare(
        "SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.attributedBody,
            m.is_from_me,
            m.date,
            m.date_read,
            m.date_delivered,
            m.handle_id,
            m.service,
            m.associated_message_type,
            m.associated_message_guid,
            m.cache_has_attachments,
            m.thread_originator_guid,
            m.group_title,
            m.is_audio_message,
            cmj.chat_id
         FROM message AS m
         INNER JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE cmj.chat_id = ?1
         ORDER BY m.date ASC
         LIMIT ?2 OFFSET ?3",
    )?;

    let messages: Vec<Message> = stmt
        .query_map(params![chat_id, limit, offset], |row| {
            Ok(RawMessageRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                text: row.get(2)?,
                attributed_body: row.get(3)?,
                is_from_me: row.get(4)?,
                date: row.get(5)?,
                date_read: row.get(6)?,
                date_delivered: row.get(7)?,
                handle_id: row.get(8)?,
                service: row.get(9)?,
                associated_message_type: row.get(10)?,
                associated_message_guid: row.get(11)?,
                cache_has_attachments: row.get(12)?,
                thread_originator_guid: row.get(13)?,
                group_title: row.get(14)?,
                is_audio_message: row.get(15)?,
                chat_id: row.get(16)?,
            })
        })?
        .filter_map(|r| r.ok())
        .map(|raw| {
            let sender = handle_map.get(&raw.handle_id).cloned();
            let sender_display_name = sender
                .as_ref()
                .and_then(|s| contacts_db::resolve_name(s, contact_map));
            raw.into_message(sender, sender_display_name)
        })
        .collect();

    Ok(messages)
}

pub fn get_total_message_count(conn: &Connection) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM message WHERE associated_message_type = 0",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn get_attachments_for_message(conn: &Connection, message_id: i64) -> AppResult<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT
            a.ROWID,
            a.guid,
            a.filename,
            a.mime_type,
            a.uti,
            a.transfer_name,
            a.total_bytes,
            a.is_outgoing,
            maj.message_id
         FROM attachment AS a
         INNER JOIN message_attachment_join AS maj ON maj.attachment_id = a.ROWID
         WHERE maj.message_id = ?1",
    )?;

    let attachments: Vec<Attachment> = stmt
        .query_map(params![message_id], |row| {
            Ok(Attachment {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                uti: row.get(4)?,
                transfer_name: row.get(5)?,
                total_bytes: row.get(6)?,
                is_outgoing: {
                    let v: i64 = row.get(7)?;
                    v != 0
                },
                message_id: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(attachments)
}

fn build_handle_map(conn: &Connection) -> AppResult<HashMap<i64, String>> {
    let mut stmt = conn.prepare("SELECT ROWID, id FROM handle")?;
    let map: HashMap<i64, String> = stmt
        .query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let id: String = row.get(1)?;
            Ok((rowid, id))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(map)
}

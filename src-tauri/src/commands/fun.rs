use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::contacts_db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ── Response types ──────────────────────────────────────────────────────

// -- Group Chat Dynamics --

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantStats {
    pub handle_id: i64,
    pub display_name: Option<String>,
    pub message_count: i64,
    pub avg_message_length: f64,
    pub replies_triggered: i64,
    pub ignored_count: i64,
    pub first_message_date: String,
    pub last_message_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupChatDynamics {
    pub participants: Vec<ParticipantStats>,
    pub total_messages: i64,
    pub most_active_participant: Option<String>,
    pub conversation_starter: Option<String>,
}

// -- On This Day --

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnThisDayMessage {
    pub year: i64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub sender: Option<String>,
    pub chat_display_name: Option<String>,
    pub date: i64,
    pub chat_id: i64,
    pub message_rowid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnThisDayResult {
    pub messages: Vec<OnThisDayMessage>,
    pub years_with_messages: Vec<i64>,
}

// -- Texting Personality --

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextingPersonality {
    pub primary_type: String,
    pub secondary_type: Option<String>,
    pub traits: Vec<PersonalityTrait>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityTrait {
    pub name: String,
    pub description: String,
    pub score: f64,
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Per-participant analytics for a group chat. Computes message counts,
/// average message lengths, reply/ignore dynamics, and identifies who
/// starts conversations most often (4-hour gap rule).
#[tauri::command]
pub async fn get_group_chat_dynamics(
    state: State<'_, AppState>,
    chat_id: i64,
) -> AppResult<GroupChatDynamics> {
    let chat_db_mutex = state.chat_db.clone();
    let contact_map = state.contact_map.lock().map_err(|e| AppError::Custom(e.to_string()))?.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<GroupChatDynamics> {
        let guard = chat_db_mutex
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let conn = guard.as_ref().ok_or(AppError::FullDiskAccessRequired)?;

        // Build handle_id -> handle identifier string map for name resolution
        let handle_map = build_handle_map(conn)?;

        // Fetch all messages for this chat, ordered chronologically
        let sql = "SELECT
                message.date,
                message.is_from_me,
                message.handle_id,
                message.text,
                message.attributedBody
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             WHERE cmj.chat_id = ?
             ORDER BY message.date ASC";

        let mut stmt = conn.prepare(sql)?;

        struct MsgRow {
            date: i64,
            is_from_me: bool,
            handle_id: i64,
            text: Option<String>,
            attributed_body: Option<Vec<u8>>,
        }

        let rows: Vec<MsgRow> = stmt
            .query_map([chat_id], |row| {
                let is_from_me_val: i64 = row.get(1)?;
                Ok(MsgRow {
                    date: row.get(0)?,
                    is_from_me: is_from_me_val != 0,
                    handle_id: row.get(2)?,
                    text: row.get(3)?,
                    attributed_body: row.get(4)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            return Ok(GroupChatDynamics {
                participants: Vec::new(),
                total_messages: 0,
                most_active_participant: None,
                conversation_starter: None,
            });
        }

        // Use -1 as synthetic handle_id for "me"
        let effective_handle = |msg: &MsgRow| -> i64 {
            if msg.is_from_me { -1 } else { msg.handle_id }
        };

        // Per-participant accumulators
        struct Accum {
            message_count: i64,
            total_text_length: i64,
            text_message_count: i64,
            replies_triggered: i64,
            ignored_count: i64,
            first_date: i64,
            last_date: i64,
            initiations: i64,
        }

        let mut accums: HashMap<i64, Accum> = HashMap::new();

        let two_hours_ns: i64 = 2 * 3600 * 1_000_000_000;
        let four_hours_ns: i64 = 4 * 3600 * 1_000_000_000;

        // First pass: basic counts
        for msg in &rows {
            let hid = effective_handle(msg);
            let text_len = resolve_text_length(&msg.text, &msg.attributed_body);
            let acc = accums.entry(hid).or_insert(Accum {
                message_count: 0,
                total_text_length: 0,
                text_message_count: 0,
                replies_triggered: 0,
                ignored_count: 0,
                first_date: msg.date,
                last_date: msg.date,
                initiations: 0,
            });
            acc.message_count += 1;
            if text_len > 0 {
                acc.total_text_length += text_len;
                acc.text_message_count += 1;
            }
            if msg.date < acc.first_date {
                acc.first_date = msg.date;
            }
            if msg.date > acc.last_date {
                acc.last_date = msg.date;
            }
        }

        // Second pass: walk message list to compute replies_triggered, ignored_count, initiations
        for i in 0..rows.len() {
            let current_hid = effective_handle(&rows[i]);

            // Conversation starter: first message or message after 4h+ gap
            if i == 0 || (rows[i].date - rows[i - 1].date >= four_hours_ns) {
                if let Some(acc) = accums.get_mut(&current_hid) {
                    acc.initiations += 1;
                }
            }

            // Look at the next message for replies_triggered / ignored_count
            if i + 1 < rows.len() {
                let next_hid = effective_handle(&rows[i + 1]);
                let gap = rows[i + 1].date - rows[i].date;

                if next_hid != current_hid && gap < two_hours_ns && gap >= 0 {
                    // Someone else replied within 2 hours
                    if let Some(acc) = accums.get_mut(&current_hid) {
                        acc.replies_triggered += 1;
                    }
                }
            }

            // ignored_count: this message is the last before a 2h+ gap (or end of chat),
            // AND the next message (if any) is from someone else
            let is_ignored = if i + 1 < rows.len() {
                let next_hid = effective_handle(&rows[i + 1]);
                let gap = rows[i + 1].date - rows[i].date;
                gap >= two_hours_ns && next_hid != current_hid
            } else {
                // Last message in chat — only count as ignored if it's not the only message
                rows.len() > 1
            };

            if is_ignored {
                if let Some(acc) = accums.get_mut(&current_hid) {
                    acc.ignored_count += 1;
                }
            }
        }

        // Resolve names and build participant stats
        let resolve_display_name = |hid: i64| -> Option<String> {
            if hid == -1 {
                Some("You".to_string())
            } else {
                handle_map
                    .get(&hid)
                    .and_then(|handle_str| contacts_db::resolve_name(handle_str, &contact_map))
                    .or_else(|| handle_map.get(&hid).cloned())
            }
        };

        let total_messages: i64 = rows.len() as i64;

        let mut participants: Vec<ParticipantStats> = accums
            .iter()
            .map(|(&hid, acc)| {
                let avg_len = if acc.text_message_count > 0 {
                    acc.total_text_length as f64 / acc.text_message_count as f64
                } else {
                    0.0
                };

                ParticipantStats {
                    handle_id: hid,
                    display_name: resolve_display_name(hid),
                    message_count: acc.message_count,
                    avg_message_length: avg_len,
                    replies_triggered: acc.replies_triggered,
                    ignored_count: acc.ignored_count,
                    first_message_date: apple_ns_to_date_string(acc.first_date),
                    last_message_date: apple_ns_to_date_string(acc.last_date),
                }
            })
            .collect();

        // Sort by message_count descending
        participants.sort_by(|a, b| b.message_count.cmp(&a.message_count));

        let most_active_participant = participants
            .first()
            .and_then(|p| p.display_name.clone());

        // Conversation starter: whoever has the most initiations
        let conversation_starter = accums
            .iter()
            .max_by_key(|(_, acc)| acc.initiations)
            .and_then(|(&hid, _)| resolve_display_name(hid));

        Ok(GroupChatDynamics {
            participants,
            total_messages,
            most_active_participant,
            conversation_starter,
        })
    })
    .await
    .map_err(|e| AppError::Custom(format!("Task join error: {e}")))?;

    result
}

/// Return messages from the same month+day across all years ("On This Day").
/// Optionally filter to a specific chat. Returns up to ~5 messages per year.
#[tauri::command]
pub async fn get_on_this_day(
    state: State<'_, AppState>,
    chat_id: Option<i64>,
    month: i64,
    day: i64,
) -> AppResult<OnThisDayResult> {
    let chat_db_mutex = state.chat_db.clone();
    let contact_map = state.contact_map.lock().map_err(|e| AppError::Custom(e.to_string()))?.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<OnThisDayResult> {
        let guard = chat_db_mutex
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let conn = guard.as_ref().ok_or(AppError::FullDiskAccessRequired)?;

        let handle_map = build_handle_map(conn)?;

        let month_str = format!("{:02}", month);
        let day_str = format!("{:02}", day);

        let chat_filter = if chat_id.is_some() {
            "AND cmj.chat_id = ?3"
        } else {
            ""
        };

        let sql = format!(
            "SELECT
                CAST(strftime('%Y', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer) AS year,
                message.text,
                message.attributedBody,
                message.is_from_me,
                message.handle_id,
                message.date,
                c.display_name AS chat_display_name,
                c.chat_identifier,
                message.ROWID AS message_rowid,
                cmj.chat_id AS chat_id
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             INNER JOIN chat AS c ON c.ROWID = cmj.chat_id
             WHERE strftime('%m', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) = ?1
               AND strftime('%d', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) = ?2
               {chat_filter}
             ORDER BY message.date ASC"
        );

        let mut stmt = conn.prepare(&sql)?;

        struct OtdRow {
            year: i64,
            text: Option<String>,
            attributed_body: Option<Vec<u8>>,
            is_from_me: bool,
            handle_id: i64,
            date: i64,
            chat_display_name: Option<String>,
            chat_identifier: String,
            message_rowid: i64,
            chat_id: i64,
        }

        let query_rows: Vec<OtdRow> = if let Some(cid) = chat_id {
            stmt.query_map(rusqlite::params![month_str, day_str, cid], |row| {
                let is_from_me_val: i64 = row.get(3)?;
                Ok(OtdRow {
                    year: row.get(0)?,
                    text: row.get(1)?,
                    attributed_body: row.get(2)?,
                    is_from_me: is_from_me_val != 0,
                    handle_id: row.get(4)?,
                    date: row.get(5)?,
                    chat_display_name: row.get(6)?,
                    chat_identifier: row.get(7)?,
                    message_rowid: row.get(8)?,
                    chat_id: row.get(9)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect()
        } else {
            stmt.query_map(rusqlite::params![month_str, day_str], |row| {
                let is_from_me_val: i64 = row.get(3)?;
                Ok(OtdRow {
                    year: row.get(0)?,
                    text: row.get(1)?,
                    attributed_body: row.get(2)?,
                    is_from_me: is_from_me_val != 0,
                    handle_id: row.get(4)?,
                    date: row.get(5)?,
                    chat_display_name: row.get(6)?,
                    chat_identifier: row.get(7)?,
                    message_rowid: row.get(8)?,
                    chat_id: row.get(9)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // Group by year and limit to ~5 per year
        let mut by_year: HashMap<i64, Vec<&OtdRow>> = HashMap::new();
        for row in &query_rows {
            by_year.entry(row.year).or_default().push(row);
        }

        let mut years_with_messages: Vec<i64> = by_year.keys().copied().collect();
        years_with_messages.sort();

        let mut messages: Vec<OnThisDayMessage> = Vec::new();

        for &year in &years_with_messages {
            if let Some(year_rows) = by_year.get(&year) {
                // Take a representative sample: up to 5 messages per year
                let sample_size = 5.min(year_rows.len());
                let step = if year_rows.len() > sample_size {
                    year_rows.len() / sample_size
                } else {
                    1
                };

                let mut count = 0;
                let mut idx = 0;
                while count < sample_size && idx < year_rows.len() {
                    let row = year_rows[idx];
                    let resolved_text = resolve_text(&row.text, &row.attributed_body);

                    let sender = if row.is_from_me {
                        Some("You".to_string())
                    } else {
                        handle_map
                            .get(&row.handle_id)
                            .and_then(|h| contacts_db::resolve_name(h, &contact_map))
                            .or_else(|| handle_map.get(&row.handle_id).cloned())
                    };

                    let chat_name = row.chat_display_name.clone().unwrap_or_else(|| {
                        // For 1:1 chats, resolve the chat_identifier to a name
                        contacts_db::resolve_name(&row.chat_identifier, &contact_map)
                            .unwrap_or_else(|| row.chat_identifier.clone())
                    });

                    messages.push(OnThisDayMessage {
                        year: row.year,
                        text: resolved_text,
                        is_from_me: row.is_from_me,
                        sender,
                        chat_display_name: Some(chat_name),
                        date: crate::ingestion::timestamp::apple_timestamp_to_unix_ms(row.date),
                        chat_id: row.chat_id,
                        message_rowid: row.message_rowid,
                    });

                    count += 1;
                    idx += step;
                }
            }
        }

        Ok(OnThisDayResult {
            messages,
            years_with_messages,
        })
    })
    .await
    .map_err(|e| AppError::Custom(format!("Task join error: {e}")))?;

    result
}

/// Classify your texting personality based on message patterns.
/// Analyzes only messages where is_from_me = 1.
/// Optionally filter to a specific chat.
#[tauri::command]
pub async fn get_texting_personality(
    state: State<'_, AppState>,
    chat_id: Option<i64>,
) -> AppResult<TextingPersonality> {
    let chat_db_mutex = state.chat_db.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<TextingPersonality> {
        let guard = chat_db_mutex
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let conn = guard.as_ref().ok_or(AppError::FullDiskAccessRequired)?;

        let chat_filter = if chat_id.is_some() {
            "AND cmj.chat_id = ?1"
        } else {
            ""
        };

        // 1. Hourly distribution (for Night Owl / Early Bird)
        let hour_sql = format!(
            "SELECT
                CAST(strftime('%H', DATETIME(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer) AS hour,
                COUNT(*) AS cnt
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             WHERE message.is_from_me = 1
             {chat_filter}
             GROUP BY hour"
        );

        let mut hour_stmt = conn.prepare(&hour_sql)?;
        let hour_rows: Vec<(i64, i64)> = if let Some(cid) = chat_id {
            hour_stmt
                .query_map([cid], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            hour_stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let total_messages: i64 = hour_rows.iter().map(|(_, c)| c).sum();
        if total_messages == 0 {
            return Ok(TextingPersonality {
                primary_type: "Silent Observer".to_string(),
                secondary_type: None,
                traits: Vec::new(),
            });
        }

        let mut night_owl_count: i64 = 0; // 22-23, 0-4
        let mut early_bird_count: i64 = 0; // 5-7
        for &(hour, count) in &hour_rows {
            if hour >= 22 || hour < 5 {
                night_owl_count += count;
            }
            if (5..8).contains(&hour) {
                early_bird_count += count;
            }
        }
        let night_owl_ratio = night_owl_count as f64 / total_messages as f64;
        let early_bird_ratio = early_bird_count as f64 / total_messages as f64;

        // 2. Average message length (for Essay Writer / Rapid Fire)
        let avg_len_sql = format!(
            "SELECT AVG(LENGTH(message.text)) AS avg_len
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             WHERE message.is_from_me = 1
               AND message.text IS NOT NULL
               AND LENGTH(message.text) > 0
             {chat_filter}"
        );

        let mut avg_stmt = conn.prepare(&avg_len_sql)?;
        let avg_length: f64 = if let Some(cid) = chat_id {
            avg_stmt
                .query_row([cid], |row| row.get::<_, Option<f64>>(0))
                .unwrap_or(None)
                .unwrap_or(0.0)
        } else {
            avg_stmt
                .query_row([], |row| row.get::<_, Option<f64>>(0))
                .unwrap_or(None)
                .unwrap_or(0.0)
        };

        // 3. Weekend ratio (for Weekend Warrior)
        let weekend_sql = format!(
            "SELECT
                SUM(CASE WHEN CAST(strftime('%w', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer) IN (0, 6) THEN 1 ELSE 0 END) AS weekend,
                COUNT(*) AS total
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             WHERE message.is_from_me = 1
             {chat_filter}"
        );

        let mut weekend_stmt = conn.prepare(&weekend_sql)?;
        let (weekend_count, weekend_total): (i64, i64) = if let Some(cid) = chat_id {
            weekend_stmt
                .query_row([cid], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap_or((0, 1))
        } else {
            weekend_stmt
                .query_row([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap_or((0, 1))
        };
        let weekend_ratio = if weekend_total > 0 {
            weekend_count as f64 / weekend_total as f64
        } else {
            0.0
        };

        // 4. Response time + initiation stats (walk messages chronologically)
        let msg_sql = format!(
            "SELECT message.date, message.is_from_me
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             WHERE 1=1
             {chat_filter}
             ORDER BY message.date ASC"
        );

        let mut msg_stmt = conn.prepare(&msg_sql)?;
        let msg_rows: Vec<(i64, bool)> = if let Some(cid) = chat_id {
            msg_stmt
                .query_map([cid], |row| {
                    let date: i64 = row.get(0)?;
                    let ifm: i64 = row.get(1)?;
                    Ok((date, ifm != 0))
                })?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            msg_stmt
                .query_map([], |row| {
                    let date: i64 = row.get(0)?;
                    let ifm: i64 = row.get(1)?;
                    Ok((date, ifm != 0))
                })?
                .filter_map(|r| r.ok())
                .collect()
        };

        let gap_threshold_ns: i64 = 4 * 3600 * 1_000_000_000;
        let mut my_initiations: i64 = 0;
        let mut total_initiations: i64 = 0;
        let mut my_response_deltas: Vec<f64> = Vec::new();
        let max_gap_secs: f64 = 24.0 * 3600.0;

        // Track burst gaps for Ghost detection
        let mut my_burst_gaps: Vec<f64> = Vec::new();
        let mut last_my_msg_date: Option<i64> = None;

        for i in 0..msg_rows.len() {
            let (date, is_from_me) = msg_rows[i];

            // Initiation detection
            let is_initiation = if i == 0 {
                true
            } else {
                date - msg_rows[i - 1].0 >= gap_threshold_ns
            };

            if is_initiation {
                total_initiations += 1;
                if is_from_me {
                    my_initiations += 1;
                }
            }

            // Response time: received -> my reply
            if is_from_me && i > 0 {
                let (prev_date, prev_from_me) = msg_rows[i - 1];
                if !prev_from_me {
                    let delta_secs = (date as f64 - prev_date as f64) / 1_000_000_000.0;
                    if delta_secs > 0.0 && delta_secs <= max_gap_secs {
                        my_response_deltas.push(delta_secs);
                    }
                }
            }

            // Burst gap tracking for Ghost
            if is_from_me {
                if let Some(last) = last_my_msg_date {
                    let gap_secs = (date as f64 - last as f64) / 1_000_000_000.0;
                    if gap_secs > 0.0 {
                        my_burst_gaps.push(gap_secs);
                    }
                }
                last_my_msg_date = Some(date);
            }
        }

        let initiation_ratio = if total_initiations > 0 {
            my_initiations as f64 / total_initiations as f64
        } else {
            0.0
        };

        let avg_response_secs = if !my_response_deltas.is_empty() {
            my_response_deltas.iter().sum::<f64>() / my_response_deltas.len() as f64
        } else {
            0.0
        };

        // Ghost metric: average gap between user's own messages (high = ghosting)
        let avg_burst_gap_secs = if !my_burst_gaps.is_empty() {
            my_burst_gaps.iter().sum::<f64>() / my_burst_gaps.len() as f64
        } else {
            0.0
        };

        // 5. Compute all personality trait scores
        let mut traits: Vec<PersonalityTrait> = Vec::new();

        // Night Owl
        traits.push(PersonalityTrait {
            name: "Night Owl".to_string(),
            description: format!(
                "{:.0}% of your messages are sent between 10pm and 5am.",
                night_owl_ratio * 100.0
            ),
            score: night_owl_ratio.min(1.0),
        });

        // Early Bird
        traits.push(PersonalityTrait {
            name: "Early Bird".to_string(),
            description: format!(
                "{:.0}% of your messages are sent between 5am and 8am.",
                early_bird_ratio * 100.0
            ),
            score: early_bird_ratio.min(1.0),
        });

        // Essay Writer
        let essay_score = (avg_length / 160.0).min(1.0);
        traits.push(PersonalityTrait {
            name: "Essay Writer".to_string(),
            description: format!(
                "Your average message is {:.0} characters long.",
                avg_length
            ),
            score: essay_score,
        });

        // Rapid Fire
        let rapid_fire_score = if avg_length < 30.0 && avg_response_secs > 0.0 && avg_response_secs < 120.0 {
            let length_factor = 1.0 - (avg_length / 30.0);
            let speed_factor = 1.0 - (avg_response_secs / 120.0);
            ((length_factor + speed_factor) / 2.0).min(1.0)
        } else if avg_length < 30.0 {
            (1.0 - avg_length / 30.0) * 0.5
        } else {
            0.0
        };
        traits.push(PersonalityTrait {
            name: "Rapid Fire".to_string(),
            description: format!(
                "Short messages ({:.0} chars avg) with {:.0}s avg response time.",
                avg_length, avg_response_secs
            ),
            score: rapid_fire_score,
        });

        // Conversation Starter
        traits.push(PersonalityTrait {
            name: "Conversation Starter".to_string(),
            description: format!(
                "You initiated {:.0}% of conversations ({} of {}).",
                initiation_ratio * 100.0, my_initiations, total_initiations
            ),
            score: initiation_ratio.min(1.0),
        });

        // Slow Burn
        let slow_burn_score = if avg_response_secs > 1800.0 && avg_length > 60.0 {
            let time_factor = ((avg_response_secs - 1800.0) / 3600.0).min(1.0);
            let length_factor = ((avg_length - 60.0) / 100.0).min(1.0);
            ((time_factor + length_factor) / 2.0).min(1.0)
        } else {
            0.0
        };
        traits.push(PersonalityTrait {
            name: "Slow Burn".to_string(),
            description: format!(
                "You take your time ({:.0}min avg response) but write thoughtful messages ({:.0} chars avg).",
                avg_response_secs / 60.0, avg_length
            ),
            score: slow_burn_score,
        });

        // Weekend Warrior
        traits.push(PersonalityTrait {
            name: "Weekend Warrior".to_string(),
            description: format!(
                "{:.0}% of your messages are on weekends.",
                weekend_ratio * 100.0
            ),
            score: if weekend_ratio > 0.4 {
                weekend_ratio.min(1.0)
            } else {
                (weekend_ratio / 0.4) * 0.5
            },
        });

        // Ghost
        let ghost_score = if avg_burst_gap_secs > 3600.0 {
            ((avg_burst_gap_secs - 3600.0) / 7200.0).min(1.0)
        } else {
            0.0
        };
        traits.push(PersonalityTrait {
            name: "Ghost".to_string(),
            description: format!(
                "Average gap between your messages: {:.0} minutes.",
                avg_burst_gap_secs / 60.0
            ),
            score: ghost_score,
        });

        // Sort traits by score descending
        traits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        // Pick primary and secondary types using thresholds
        let primary_type = determine_primary_type(&traits);
        let secondary_type = traits
            .iter()
            .find(|t| t.name != primary_type && t.score > 0.1)
            .map(|t| t.name.clone());

        Ok(TextingPersonality {
            primary_type,
            secondary_type,
            traits,
        })
    })
    .await
    .map_err(|e| AppError::Custom(format!("Task join error: {e}")))?;

    result
}

// ── Private helpers ─────────────────────────────────────────────────────

/// Build a HashMap of handle_id -> handle identifier string.
fn build_handle_map(conn: &rusqlite::Connection) -> AppResult<HashMap<i64, String>> {
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

/// Resolve message text, falling back to attributedBody parsing.
fn resolve_text(text: &Option<String>, attributed_body: &Option<Vec<u8>>) -> Option<String> {
    if let Some(t) = text {
        let cleaned: String = t
            .chars()
            .filter(|c| *c != '\u{FFFC}' && *c != '\u{FFFD}')
            .collect();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        }
    } else {
        attributed_body
            .as_ref()
            .and_then(|blob| crate::ingestion::message_parser::extract_text_from_attributed_body(blob))
    }
}

/// Get the length of the message text, resolving attributedBody if needed.
fn resolve_text_length(text: &Option<String>, attributed_body: &Option<Vec<u8>>) -> i64 {
    resolve_text(text, attributed_body)
        .map(|t| t.len() as i64)
        .unwrap_or(0)
}

/// Convert an Apple nanosecond timestamp to "YYYY-MM-DD" string.
fn apple_ns_to_date_string(apple_ns: i64) -> String {
    let unix_secs = apple_ns / 1_000_000_000 + 978_307_200;
    let dt = chrono::DateTime::from_timestamp(unix_secs, 0);
    match dt {
        Some(d) => d.format("%Y-%m-%d").to_string(),
        None => "unknown".to_string(),
    }
}

/// Determine the primary personality type based on scored traits with thresholds.
fn determine_primary_type(traits: &[PersonalityTrait]) -> String {
    // The traits are already sorted by score descending.
    // Apply minimum thresholds for certain types.
    for t in traits {
        let meets_threshold = match t.name.as_str() {
            "Night Owl" => t.score > 0.25,
            "Early Bird" => t.score > 0.15,
            "Essay Writer" => t.score > 0.5, // avg > 80 chars
            "Rapid Fire" => t.score > 0.3,
            "Conversation Starter" => t.score > 0.6,
            "Slow Burn" => t.score > 0.2,
            "Weekend Warrior" => t.score > 0.4,
            "Ghost" => t.score > 0.3,
            _ => t.score > 0.2,
        };
        if meets_threshold {
            return t.name.clone();
        }
    }
    // Fallback: highest scoring trait regardless of threshold
    traits
        .first()
        .map(|t| t.name.clone())
        .unwrap_or_else(|| "Balanced".to_string())
}

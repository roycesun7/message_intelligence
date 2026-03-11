use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::analytics_db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ── Response types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedStats {
    pub message_count: MessageCount,
    pub chat_interactions: SentReceived<Vec<ChatStat>>,
    pub handle_interactions: Option<SentReceived<Vec<HandleStat>>>,
    pub weekday_interactions: SentReceived<Vec<WeekdayStat>>,
    pub monthly_interactions: SentReceived<Vec<MonthlyStat>>,
    pub late_night_interactions: SentReceived<Vec<ChatStat>>,
    pub most_popular_openers: SentReceived<Vec<OpenerStat>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCount {
    pub sent: i64,
    pub received: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentReceived<T> {
    pub sent: T,
    pub received: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStat {
    pub chat_id: i64,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleStat {
    pub handle_id: i64,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekdayStat {
    pub weekday: String,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyStat {
    pub month: String,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerStat {
    pub text: String,
    pub count: i64,
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Calculate wrapped-style analytics for a given year (0 = all time).
/// Optionally filter to specific chat IDs.
///
/// When called without chat_ids, results are cached in analytics.db so
/// subsequent loads for the same year are instant.
#[tauri::command]
pub async fn get_wrapped_stats(
    state: State<'_, AppState>,
    year: i64,
    chat_ids: Option<Vec<i64>>,
) -> AppResult<WrappedStats> {
    // Only use cache for unfiltered (global) queries
    let use_cache = chat_ids.is_none();

    // Check cache first
    if use_cache {
        let analytics_conn = state
            .analytics_db
            .lock()
            .map_err(|e| AppError::Custom(e.to_string()))?;
        if let Some(json) = analytics_db::get_cached_wrapped(&analytics_conn, year) {
            if let Ok(stats) = serde_json::from_str::<WrappedStats>(&json) {
                return Ok(stats);
            }
            // Cache entry exists but is corrupt; fall through to recompute.
        }
    }

    // Compute on a blocking thread to avoid holding the mutex across await points
    // and to keep the UI responsive during heavy SQL work.
    let chat_db_mutex = state.chat_db.clone();
    let analytics_db_mutex = state.analytics_db.clone();
    let chat_ids_clone = chat_ids.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<WrappedStats> {
        let conn = chat_db_mutex
            .lock()
            .map_err(|e| AppError::Custom(e.to_string()))?;

        let cids = chat_ids_clone.as_deref();

        let message_count = count_messages_by_year(&conn, year, cids)?;
        let chat_interactions = count_messages_by_chat(&conn, year, cids)?;
        let handle_interactions = count_messages_by_handle(&conn, year, cids)?;
        let weekday_interactions = count_messages_by_weekday(&conn, year, cids)?;
        let monthly_interactions = count_messages_by_month(&conn, year, cids)?;
        let late_night_interactions = late_night_messenger(&conn, year, cids)?;
        let most_popular_openers = get_most_popular_openers(&conn, year, cids)?;

        let stats = WrappedStats {
            message_count,
            chat_interactions,
            handle_interactions,
            weekday_interactions,
            monthly_interactions,
            late_night_interactions,
            most_popular_openers,
        };

        // Persist to cache for unfiltered queries
        if use_cache {
            if let Ok(json) = serde_json::to_string(&stats) {
                let a_conn = analytics_db_mutex
                    .lock()
                    .map_err(|e| AppError::Custom(e.to_string()))?;
                let _ = analytics_db::set_cached_wrapped(&a_conn, year, &json);
            }
        }

        Ok(stats)
    })
    .await
    .map_err(|e| AppError::Custom(format!("Task join error: {e}")))?;

    result
}

/// Invalidate (clear) the wrapped stats cache.
/// Pass a specific year to clear just that year, or omit to clear all.
#[tauri::command]
pub fn invalidate_wrapped_cache(
    state: State<'_, AppState>,
    year: Option<i64>,
) -> AppResult<()> {
    let conn = state
        .analytics_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    analytics_db::invalidate_wrapped_cache(&conn, year)
}

// ── Private helpers ─────────────────────────────────────────────────────

/// Apple epoch offset: 978307200 seconds between Unix epoch and 2001-01-01.
const APPLE_EPOCH_SECS: i64 = 978_307_200;

/// Build the WHERE clause fragment for year + optional chat ID filtering.
/// Returns (clause_string, params_vec).
fn year_filter_clause(year: i64, chat_ids: Option<&[i64]>) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if year != 0 {
        // Use chrono to build precise year boundaries.
        let start_ms = chrono::NaiveDate::from_ymd_opt(year as i32, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let end_ms = chrono::NaiveDate::from_ymd_opt((year + 1) as i32, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();

        let start_offset = (start_ms - APPLE_EPOCH_SECS * 1000) * 1_000_000;
        let end_offset = (end_ms - APPLE_EPOCH_SECS * 1000) * 1_000_000;

        clauses.push("message.date > ?".to_string());
        params_vec.push(Box::new(start_offset));
        clauses.push("message.date < ?".to_string());
        params_vec.push(Box::new(end_offset));
    }

    if let Some(ids) = chat_ids {
        if !ids.is_empty() {
            let placeholders: Vec<String> = ids.iter().enumerate().map(|_| "?".to_string()).collect();
            clauses.push(format!("c.ROWID IN ({})", placeholders.join(",")));
            for id in ids {
                params_vec.push(Box::new(*id));
            }
        }
    }

    let clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("AND {}", clauses.join(" AND "))
    };

    (clause, params_vec)
}

/// Build a full query using the base join + year/chat filters + is_from_me filter.
fn build_year_query(
    prefix: &str,
    suffix: &str,
    year: i64,
    chat_ids: Option<&[i64]>,
    is_from_me: bool,
) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let (filter_clause, mut filter_params) = year_filter_clause(year, chat_ids);

    let sql = format!(
        "{prefix}
         FROM message
         INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
         INNER JOIN chat AS c ON c.ROWID = cmj.chat_id
         WHERE message.is_from_me = ?
         {filter_clause}
         {suffix}"
    );

    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    all_params.push(Box::new(is_from_me as i64));
    all_params.append(&mut filter_params);

    (sql, all_params)
}

/// Collect params into a Vec<&dyn ToSql> for rusqlite.
fn as_params(params: &[Box<dyn rusqlite::types::ToSql>]) -> Vec<&dyn rusqlite::types::ToSql> {
    params.iter().map(|p| p.as_ref()).collect()
}

fn count_messages_by_year(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<MessageCount> {
    let count_for = |is_from_me: bool| -> AppResult<i64> {
        let (sql, params_vec) = build_year_query(
            "SELECT COUNT(message.ROWID) AS cnt",
            "",
            year,
            chat_ids,
            is_from_me,
        );
        let p = as_params(&params_vec);
        let count: i64 = conn.query_row(&sql, p.as_slice(), |row| row.get(0))?;
        Ok(count)
    };

    Ok(MessageCount {
        sent: count_for(true)?,
        received: count_for(false)?,
    })
}

fn count_messages_by_chat(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<SentReceived<Vec<ChatStat>>> {
    let query_for = |is_from_me: bool| -> AppResult<Vec<ChatStat>> {
        let (sql, params_vec) = build_year_query(
            "SELECT c.ROWID AS chat_id, COUNT(message.ROWID) AS message_count",
            "GROUP BY chat_id ORDER BY message_count DESC",
            year,
            chat_ids,
            is_from_me,
        );
        let p = as_params(&params_vec);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(p.as_slice(), |row| {
                Ok(ChatStat {
                    chat_id: row.get(0)?,
                    message_count: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    };

    Ok(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    })
}

fn count_messages_by_handle(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<Option<SentReceived<Vec<HandleStat>>>> {
    // Only meaningful when filtering by chat
    if chat_ids.is_none() || chat_ids.map_or(true, |ids| ids.is_empty()) {
        return Ok(None);
    }

    let query_for = |is_from_me: bool| -> AppResult<Vec<HandleStat>> {
        let (sql, params_vec) = build_year_query(
            "SELECT message.handle_id AS handle_id, COUNT(message.ROWID) AS message_count",
            "GROUP BY message.handle_id ORDER BY message_count DESC",
            year,
            chat_ids,
            is_from_me,
        );
        let p = as_params(&params_vec);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(p.as_slice(), |row| {
                Ok(HandleStat {
                    handle_id: row.get(0)?,
                    message_count: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    };

    Ok(Some(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    }))
}

fn count_messages_by_weekday(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<SentReceived<Vec<WeekdayStat>>> {
    let query_for = |is_from_me: bool| -> AppResult<Vec<WeekdayStat>> {
        let (sql, params_vec) = build_year_query(
            "SELECT
                CASE CAST(strftime('%w', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer)
                    WHEN 0 THEN 'Sunday'
                    WHEN 1 THEN 'Monday'
                    WHEN 2 THEN 'Tuesday'
                    WHEN 3 THEN 'Wednesday'
                    WHEN 4 THEN 'Thursday'
                    WHEN 5 THEN 'Friday'
                    ELSE 'Saturday'
                END AS weekday,
                COUNT(message.ROWID) AS message_count",
            "GROUP BY weekday ORDER BY message_count DESC",
            year,
            chat_ids,
            is_from_me,
        );
        let p = as_params(&params_vec);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(p.as_slice(), |row| {
                Ok(WeekdayStat {
                    weekday: row.get(0)?,
                    message_count: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    };

    Ok(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    })
}

fn count_messages_by_month(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<SentReceived<Vec<MonthlyStat>>> {
    let query_for = |is_from_me: bool| -> AppResult<Vec<MonthlyStat>> {
        let (sql, params_vec) = build_year_query(
            "SELECT
                CASE CAST(strftime('%m', DATE(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer)
                    WHEN 1 THEN 'January'
                    WHEN 2 THEN 'February'
                    WHEN 3 THEN 'March'
                    WHEN 4 THEN 'April'
                    WHEN 5 THEN 'May'
                    WHEN 6 THEN 'June'
                    WHEN 7 THEN 'July'
                    WHEN 8 THEN 'August'
                    WHEN 9 THEN 'September'
                    WHEN 10 THEN 'October'
                    WHEN 11 THEN 'November'
                    ELSE 'December'
                END AS month,
                COUNT(message.ROWID) AS message_count",
            "GROUP BY month ORDER BY message_count DESC",
            year,
            chat_ids,
            is_from_me,
        );
        let p = as_params(&params_vec);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(p.as_slice(), |row| {
                Ok(MonthlyStat {
                    month: row.get(0)?,
                    message_count: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    };

    Ok(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    })
}

fn late_night_messenger(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<SentReceived<Vec<ChatStat>>> {
    let query_for = |is_from_me: bool| -> AppResult<Vec<ChatStat>> {
        let (filter_clause, mut filter_params) = year_filter_clause(year, chat_ids);

        let sql = format!(
            "SELECT c.ROWID AS chat_id, COUNT(message.ROWID) AS message_count
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             INNER JOIN chat AS c ON c.ROWID = cmj.chat_id
             WHERE message.is_from_me = ?
             AND (
                 CAST(strftime('%H', DATETIME(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer) > 22
                 OR CAST(strftime('%H', DATETIME(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS integer) < 5
             )
             {filter_clause}
             GROUP BY chat_id
             ORDER BY message_count DESC"
        );

        let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        all_params.push(Box::new(is_from_me as i64));
        all_params.append(&mut filter_params);
        let p = as_params(&all_params);

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(p.as_slice(), |row| {
                Ok(ChatStat {
                    chat_id: row.get(0)?,
                    message_count: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    };

    Ok(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    })
}

fn get_most_popular_openers(
    conn: &Connection,
    year: i64,
    chat_ids: Option<&[i64]>,
) -> AppResult<SentReceived<Vec<OpenerStat>>> {
    let query_for = |is_from_me: bool| -> AppResult<Vec<OpenerStat>> {
        let (filter_clause, mut filter_params) = year_filter_clause(year, chat_ids);

        let sql = format!(
            "SELECT m_text.text, m_text.attributedBody
             FROM message
             INNER JOIN chat_message_join AS cmj ON cmj.message_id = message.ROWID
             INNER JOIN chat AS c ON c.ROWID = cmj.chat_id
             LEFT JOIN message AS m_text ON m_text.ROWID = message.ROWID
             WHERE message.is_from_me = ?
             AND cmj.message_date = (
                 SELECT MIN(cmj2.message_date)
                 FROM chat_message_join AS cmj2
                 WHERE cmj2.chat_id = c.ROWID
             )
             {filter_clause}
             ORDER BY message.date ASC"
        );

        let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        all_params.push(Box::new(is_from_me as i64));
        all_params.append(&mut filter_params);
        let p = as_params(&all_params);

        let mut stmt = conn.prepare(&sql)?;

        // Collect all opener texts, resolve attributedBody when text is NULL.
        let mut opener_texts: Vec<String> = Vec::new();
        let mut rows = stmt.query(p.as_slice())?;
        while let Some(row) = rows.next()? {
            let text: Option<String> = row.get(0)?;
            let attributed_body: Option<Vec<u8>> = row.get(1)?;

            let resolved = if let Some(t) = text {
                let cleaned: String = t
                    .trim()
                    .to_lowercase()
                    .chars()
                    .filter(|c| !('\u{FFFC}'..='\u{FFFD}').contains(c))
                    .collect();
                if cleaned.is_empty() { None } else { Some(cleaned) }
            } else {
                attributed_body
                    .as_ref()
                    .and_then(|blob| {
                        crate::ingestion::message_parser::extract_text_from_attributed_body(blob)
                    })
                    .map(|s| s.trim().to_lowercase())
            };

            if let Some(t) = resolved {
                if !t.is_empty() {
                    opener_texts.push(t);
                }
            }
        }

        // Count occurrences.
        let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        for t in &opener_texts {
            *counts.entry(t.clone()).or_insert(0) += 1;
        }

        // Filter to openers used at least twice, sort DESC.
        let mut openers: Vec<OpenerStat> = counts
            .into_iter()
            .filter(|(_, count)| *count >= 2)
            .map(|(text, count)| OpenerStat { text, count })
            .collect();
        openers.sort_by(|a, b| b.count.cmp(&a.count));

        Ok(openers)
    };

    Ok(SentReceived {
        sent: query_for(true)?,
        received: query_for(false)?,
    })
}

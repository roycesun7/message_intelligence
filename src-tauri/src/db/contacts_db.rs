use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

/// Generate normalized variants of a phone number for matching.
fn normalize_phone(phone: &str) -> Vec<String> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let mut variants = vec![phone.to_string(), digits.clone()];

    // +1 prefix variants for US/CA numbers
    if digits.len() == 11 && digits.starts_with('1') {
        variants.push(format!("+{}", digits));
        variants.push(digits[1..].to_string());
        variants.push(format!("+1{}", &digits[1..]));
    } else if digits.len() == 10 {
        variants.push(format!("+1{}", digits));
        variants.push(format!("1{}", digits));
    }

    variants
}

/// Try to find a contact name for a handle identifier (phone or email).
pub fn resolve_name(handle_id: &str, contact_map: &HashMap<String, String>) -> Option<String> {
    // Try exact match first
    if let Some(name) = contact_map.get(handle_id) {
        return Some(name.clone());
    }
    // Try normalized phone variants
    for variant in normalize_phone(handle_id) {
        if let Some(name) = contact_map.get(&variant) {
            return Some(name.clone());
        }
    }
    // Try email lowercase
    if let Some(name) = contact_map.get(&handle_id.to_lowercase()) {
        return Some(name.clone());
    }
    None
}

/// Find all AddressBook-v22.abcddb files under ~/Library/Application Support/AddressBook/.
/// macOS stores contacts across multiple source directories — we must read all of them.
fn find_addressbook_dbs() -> AppResult<Vec<PathBuf>> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let ab_base = home.join("Library/Application Support/AddressBook");

    if !ab_base.exists() {
        return Err(AppError::Custom(
            "AddressBook directory not found".into(),
        ));
    }

    let mut paths = Vec::new();

    // Check Sources subdirectories
    let sources_dir = ab_base.join("Sources");
    if sources_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&sources_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let db_path = path.join("AddressBook-v22.abcddb");
                    if db_path.exists() {
                        paths.push(db_path);
                    }
                }
            }
        }
    }

    if paths.is_empty() {
        return Err(AppError::Custom(
            "AddressBook-v22.abcddb not found in any Sources subdirectory".into(),
        ));
    }

    Ok(paths)
}

/// Build a contact map: phone/email -> display name.
/// Reads the macOS Address Book SQLite database directly (requires Full Disk Access).
pub fn build_contact_map() -> AppResult<HashMap<String, String>> {
    let db_paths = find_addressbook_dbs()?;

    let mut map: HashMap<String, String> = HashMap::new();

    for db_path in &db_paths {
        let conn = match Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Cannot open AddressBook DB {:?}: {e}", db_path);
                continue;
            }
        };

        // Query phone numbers with their owner's name
        if let Ok(mut stmt) = conn.prepare(
            "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER
             FROM ZABCDRECORD r
             INNER JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
             WHERE p.ZFULLNUMBER IS NOT NULL",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                let first: Option<String> = row.get(0)?;
                let last: Option<String> = row.get(1)?;
                let org: Option<String> = row.get(2)?;
                let phone: String = row.get(3)?;
                Ok((first, last, org, phone))
            }) {
                for row in rows.flatten() {
                    let (first, last, org, phone) = row;
                    let name = build_display_name(&first, &last, &org);
                    if name.is_empty() {
                        continue;
                    }
                    for variant in normalize_phone(&phone) {
                        if !variant.is_empty() {
                            map.entry(variant).or_insert_with(|| name.clone());
                        }
                    }
                }
            }
        }

        // Query email addresses with their owner's name
        if let Ok(mut stmt) = conn.prepare(
            "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS
             FROM ZABCDRECORD r
             INNER JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
             WHERE e.ZADDRESS IS NOT NULL",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                let first: Option<String> = row.get(0)?;
                let last: Option<String> = row.get(1)?;
                let org: Option<String> = row.get(2)?;
                let email: String = row.get(3)?;
                Ok((first, last, org, email))
            }) {
                for row in rows.flatten() {
                    let (first, last, org, email) = row;
                    let name = build_display_name(&first, &last, &org);
                    if name.is_empty() {
                        continue;
                    }
                    map.entry(email.to_lowercase())
                        .or_insert_with(|| name.clone());
                    map.entry(email).or_insert(name);
                }
            }
        };
    }

    log::info!(
        "Built contact map with {} entries from {} AddressBook source(s)",
        map.len(),
        db_paths.len()
    );
    Ok(map)
}

/// Build a display name from first, last, and organization fields.
fn build_display_name(
    first: &Option<String>,
    last: &Option<String>,
    org: &Option<String>,
) -> String {
    let first_str = first.as_deref().unwrap_or("").trim();
    let last_str = last.as_deref().unwrap_or("").trim();

    if !first_str.is_empty() && !last_str.is_empty() {
        format!("{} {}", first_str, last_str)
    } else if !first_str.is_empty() {
        first_str.to_string()
    } else if !last_str.is_empty() {
        last_str.to_string()
    } else {
        // Fall back to organization
        org.as_deref().unwrap_or("").trim().to_string()
    }
}

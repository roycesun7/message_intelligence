//! Anonymous launch telemetry via PostHog.
//!
//! Sends a single event on app launch. No message data, no PII.
//! A random install ID (distinct_id) is generated once and stored locally.

use std::path::Path;

// Replace with your PostHog project API key
const POSTHOG_API_KEY: &str = "phc_tmwhlLnIIeZvPkefDfkWQsUOnWw1T8bYbSGqj5VFBNm";
const POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// Read or create a persistent random install ID.
fn get_install_id(data_dir: &Path) -> String {
    let id_path = data_dir.join(".install_id");
    if let Ok(id) = std::fs::read_to_string(&id_path) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&id_path, &id);
    id
}

/// Fire a single PostHog event on app launch.
/// Only runs in release builds — no noise from local development.
/// Failures are silently ignored — telemetry should never affect the app.
pub fn send_launch_ping(data_dir: &Path) {
    if cfg!(debug_assertions) {
        return;
    }
    let distinct_id = get_install_id(data_dir);
    let app_version = env!("CARGO_PKG_VERSION").to_string();

    let os_version = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "unknown".to_string())
        .trim()
        .to_string();

    tokio::spawn(async move {
        let body = serde_json::json!({
            "api_key": POSTHOG_API_KEY,
            "event": "app_launched",
            "distinct_id": distinct_id,
            "properties": {
                "app_version": app_version,
                "os_version": os_version,
                "os": "macOS",
                "$lib": "capsule-rust",
            }
        });

        let _ = reqwest::Client::new()
            .post(format!("{POSTHOG_HOST}/capture/"))
            .json(&body)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
    });
}

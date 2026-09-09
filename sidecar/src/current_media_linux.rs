use serde_json::{Value, json};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn number(value: &str) -> Option<i64> {
    value
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|number| *number >= 0)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn get(_include_artwork: bool) -> Result<Value, String> {
    let format = [
        "{{playerName}}",
        "{{status}}",
        "{{position}}",
        "{{mpris:length}}",
        "{{xesam:title}}",
        "{{xesam:artist}}",
        "{{xesam:album}}",
        "{{mpris:artUrl}}",
        "{{mpris:trackid}}",
        "{{shuffle}}",
        "{{loop}}",
    ]
    .join("\t");
    let output = Command::new("playerctl")
        .args(["--all-players", "metadata", "--format", &format])
        .output()
        .map_err(|error| format!("MPRIS reader playerctl is unavailable: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sessions: Vec<Value> = stdout
        .lines()
        .filter_map(|line| {
            let columns: Vec<_> = line.split('\t').collect();
            let title = columns.get(4)?.trim();
            if title.is_empty() {
                return None;
            }
            let status = match columns.get(1).map(|value| value.trim().to_lowercase()) {
                Some(value) if value == "playing" => "playing",
                Some(value) if value == "paused" => "paused",
                Some(value) if value == "stopped" => "stopped",
                _ => "unknown",
            };
            let position_ms = columns
                .get(2)
                .and_then(|value| number(value))
                .map(|value| value / 1000);
            let duration_ms = columns
                .get(3)
                .and_then(|value| number(value))
                .map(|value| value / 1000);
            Some(json!({
                "title": title,
                "artist": columns.get(5).unwrap_or(&"").trim(),
                "album": columns.get(6).unwrap_or(&"").trim(),
                "artworkUrl": columns.get(7).unwrap_or(&"").trim(),
                "trackId": columns.get(8).unwrap_or(&"").trim(),
                "sourceAppId": columns.first().unwrap_or(&"").trim(),
                "status": status,
                "positionMs": position_ms,
                "durationMs": duration_ms,
                "playbackRate": 1.0,
                "shuffleActive": columns.get(9).and_then(|value| match value.trim().to_lowercase().as_str() {
                    "on" | "true" => Some(true), "off" | "false" => Some(false), _ => None,
                }),
                "repeatMode": match columns.get(10).map(|value| value.trim().to_lowercase()) {
                    Some(value) if value == "track" => "track",
                    Some(value) if value == "playlist" => "list",
                    Some(value) if value == "none" => "none",
                    _ => "unknown",
                },
                "controls": {
                    "play": true, "pause": true, "previous": true, "next": true,
                    "seek": position_ms.is_some(), "shuffle": true, "repeat": true
                },
                "positionSource": if position_ms.is_some() { "system" } else { "unavailable" },
                "detectedBy": "mpris",
                "sampledAt": now_ms(),
            }))
        })
        .collect();
    sessions.sort_by_key(|session| if session["status"] == "playing" { 0 } else { 1 });
    Ok(json!({ "sessions": sessions, "warnings": [] }))
}

pub fn control(
    source_app_id: &str,
    action: &str,
    position_ms: Option<i64>,
    enabled: Option<bool>,
    repeat_mode: Option<&str>,
) -> Result<Value, String> {
    let mut command = Command::new("playerctl");
    command.args(["--player", source_app_id]);
    match action {
        "play" | "pause" | "previous" | "next" => {
            command.arg(action);
        }
        "seek" => {
            let value = position_ms
                .filter(|value| *value >= 0)
                .ok_or_else(|| "A valid playback position is required".to_string())?;
            command.args(["position", &format!("{:.3}", value as f64 / 1000.0)]);
        }
        "set-shuffle" => {
            command.args(["shuffle", if enabled == Some(true) { "On" } else { "Off" }]);
        }
        "set-repeat" => {
            let mode = match repeat_mode {
                Some("none") => "None",
                Some("track") => "Track",
                Some("list") => "Playlist",
                _ => return Err("A valid repeat mode is required".into()),
            };
            command.args(["loop", mode]);
        }
        _ => return Err("Unsupported media control action".into()),
    }
    let output = command
        .output()
        .map_err(|error| format!("MPRIS control failed: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(json!({ "acknowledged": true }))
}

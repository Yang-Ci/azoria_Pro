use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ARTWORK_BYTES: u64 = 6 * 1024 * 1024;

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn file_url_path(url: &str) -> Option<PathBuf> {
    let encoded = url.strip_prefix("file://")?;
    if !encoded.starts_with('/') {
        return None;
    }
    let input = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = hex(*input.get(index + 1)?)?;
            let low = hex(*input.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok().map(PathBuf::from)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

fn artwork_data_url(url: &str, include_artwork: bool) -> String {
    if !include_artwork {
        return String::new();
    }
    if url.starts_with("data:image/") && url.len() <= MAX_ARTWORK_BYTES as usize * 2 {
        return url.to_string();
    }
    let Some(path) = file_url_path(url) else {
        return String::new();
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return String::new();
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ARTWORK_BYTES {
        return String::new();
    }
    let Ok(bytes) = fs::read(path) else {
        return String::new();
    };
    let Some(mime) = image_mime(&bytes) else {
        return String::new();
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

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

pub fn get(include_artwork: bool) -> Result<Value, String> {
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
                "artworkUrl": artwork_data_url(columns.get(7).unwrap_or(&"").trim(), include_artwork),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_file_urls() {
        assert_eq!(
            file_url_path("file:///tmp/cover%20art.png"),
            Some(PathBuf::from("/tmp/cover art.png"))
        );
        assert_eq!(file_url_path("https://example.com/cover.png"), None);
        assert_eq!(file_url_path("file://remote/cover.png"), None);
    }

    #[test]
    fn recognizes_supported_image_signatures() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_mime(b"\xff\xd8\xffrest"), Some("image/jpeg"));
        assert_eq!(image_mime(b"not an image"), None);
    }
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

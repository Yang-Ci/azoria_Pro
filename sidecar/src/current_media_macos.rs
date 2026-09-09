use serde_json::{Value, json};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn command_value(property: &str) -> Option<String> {
    let output = Command::new("nowplaying-cli")
        .args(["get", property])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn source_app_id() -> String {
    let output = Command::new("sh")
        .args([
            "-c",
            "nowplaying-cli get clientPropertiesData | base64 -D | plutil -convert json -o - -- -",
        ])
        .output();
    let decoded = output
        .ok()
        .filter(|value| value.status.success())
        .map(|value| String::from_utf8_lossy(&value.stdout).to_lowercase())
        .unwrap_or_default();
    if decoded.contains("qqmusic") || decoded.contains("tencent") {
        return "QQMusic".into();
    }
    if decoded.contains("163music") || decoded.contains("netease") || decoded.contains("cloudmusic")
    {
        return "NeteaseMusic".into();
    }
    "macOS Now Playing".into()
}

fn apple_script(app: &str, property: &str) -> Option<String> {
    let script = format!(
        "if application \"{app}\" is running then tell application \"{app}\" to get {property}"
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn get(include_artwork: bool) -> Result<Value, String> {
    if let Some(title) = command_value("title") {
        let rate = command_value("playbackRate")
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0);
        let elapsed = command_value("elapsedTime")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|value| (value * 1000.0) as i64);
        let duration = command_value("duration")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|value| (value * 1000.0) as i64);
        let shuffle_active = command_value("shuffleMode").and_then(|value| match value.trim() {
            "1" => Some(true),
            "0" => Some(false),
            _ => None,
        });
        let repeat_mode = match command_value("repeatMode").as_deref() {
            Some("1") => "track",
            Some("2") => "list",
            Some("0") => "none",
            _ => "unknown",
        };
        let artwork_url = if include_artwork {
            command_value("artworkData")
                .map(|data| {
                    let mime =
                        command_value("artworkMIMEType").unwrap_or_else(|| "image/jpeg".into());
                    format!("data:{mime};base64,{data}")
                })
                .unwrap_or_default()
        } else {
            String::new()
        };
        return Ok(json!({ "sessions": [{
            "title": title,
            "artist": command_value("artist").unwrap_or_default(),
            "album": command_value("album").unwrap_or_default(),
            "trackId": command_value("uniqueIdentifier").unwrap_or_default(),
            "artworkUrl": artwork_url,
            "sourceAppId": source_app_id(),
            "status": if rate > 0.0 { "playing" } else { "paused" },
            "positionMs": elapsed,
            "durationMs": duration,
            "playbackRate": rate,
            "shuffleActive": shuffle_active,
            "repeatMode": repeat_mode,
            "controls": {
                "play": true, "pause": true, "previous": true, "next": true,
                "seek": elapsed.is_some(), "shuffle": false, "repeat": false
            },
            "positionSource": if elapsed.is_some() { "system" } else { "unavailable" },
            "detectedBy": "mediaremote",
            "sampledAt": now_ms(),
        }], "warnings": [] }));
    }
    for (app, source) in [("Music", "Apple Music"), ("Spotify", "Spotify")] {
        if let Some(title) = apple_script(app, "name of current track") {
            let position = apple_script(app, "player position")
                .and_then(|value| value.parse::<f64>().ok())
                .map(|value| (value * 1000.0) as i64);
            let state = apple_script(app, "player state").unwrap_or_default();
            return Ok(json!({ "sessions": [{
                "title": title,
                "artist": apple_script(app, "artist of current track").unwrap_or_default(),
                "album": apple_script(app, "album of current track").unwrap_or_default(),
                "trackId": apple_script(app, "database ID of current track").unwrap_or_default(),
                "artworkUrl": "",
                "sourceAppId": source,
                "status": if state.contains("playing") { "playing" } else { "paused" },
                "positionMs": position,
                "durationMs": null,
                "playbackRate": 1.0,
                "shuffleActive": null,
                "repeatMode": "unknown",
                "controls": {
                    "play": true, "pause": true, "previous": true, "next": true,
                    "seek": position.is_some(), "shuffle": false, "repeat": false
                },
                "positionSource": if position.is_some() { "system" } else { "unavailable" },
                "detectedBy": "app-script",
                "sampledAt": now_ms(),
            }], "warnings": ["Install nowplaying-cli for system-wide macOS player detection"] }));
        }
    }
    Err("macOS Now Playing is unavailable; install nowplaying-cli".into())
}

pub fn control(
    source_app_id: &str,
    action: &str,
    position_ms: Option<i64>,
    _enabled: Option<bool>,
    _repeat_mode: Option<&str>,
) -> Result<Value, String> {
    let command = match action {
        "play" | "pause" | "previous" | "next" => action,
        "seek" => "seek",
        "set-shuffle" | "set-repeat" => {
            return Err(
                "This macOS media provider does not expose shuffle or repeat control".into(),
            );
        }
        _ => return Err("Unsupported media control action".into()),
    };
    let mut invocation = Command::new("nowplaying-cli");
    invocation.arg(command);
    if action == "seek" {
        let value = position_ms
            .filter(|value| *value >= 0)
            .ok_or_else(|| "A valid playback position is required".to_string())?;
        invocation.arg(format!("{:.3}", value as f64 / 1000.0));
    }
    match invocation.output() {
        Ok(output) if output.status.success() => Ok(json!({ "acknowledged": true })),
        Ok(output) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        Err(_) => {
            let app = if source_app_id == "Apple Music" {
                "Music"
            } else if source_app_id == "Spotify" {
                "Spotify"
            } else {
                return Err("macOS Now Playing control is unavailable".into());
            };
            let script = match action {
                "play" | "pause" | "previous" | "next" => {
                    format!("tell application \"{app}\" to {action}")
                }
                "seek" => format!(
                    "tell application \"{app}\" to set player position to {}",
                    position_ms.unwrap_or_default() as f64 / 1000.0
                ),
                _ => return Err("Unsupported media control action".into()),
            };
            let output = Command::new("osascript")
                .args(["-e", &script])
                .output()
                .map_err(|error| format!("macOS player control failed: {error}"))?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            Ok(json!({ "acknowledged": true }))
        }
    }
}

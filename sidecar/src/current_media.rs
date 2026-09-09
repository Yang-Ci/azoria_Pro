use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::DataReader;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Media::Audio::{
    DEVICE_STATE_ACTIVE, Endpoints::IAudioMeterInformation, IAudioSessionControl2,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants,
    UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId,
};
use windows::core::{BOOL, Interface, PWSTR};

fn clock_ms(value: &str) -> Option<i64> {
    let parts: Vec<_> = value.trim().split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let mut seconds = 0i64;
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let number = part.parse::<i64>().ok()?;
        if index > 0 && number >= 60 {
            return None;
        }
        seconds = seconds.checked_mul(60)?.checked_add(number)?;
    }
    (seconds <= 86_400).then_some(seconds * 1000)
}

fn progress_pair(value: &str) -> Option<(i64, i64)> {
    let (elapsed, duration) = value.trim().split_once('/')?;
    let elapsed = clock_ms(elapsed)?;
    let duration = clock_ms(duration)?;
    (duration > 0 && elapsed <= duration).then_some((elapsed, duration))
}

// Only accept an explicit elapsed/total clock pair, never a volume percentage
// or the durations of unrelated songs in the playlist.
fn accessible_progress(hwnd: HWND) -> Option<(i64, i64)> {
    unsafe {
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL).ok()?;
        let root = automation.ElementFromHandle(hwnd).ok()?;
        let condition = automation.CreateTrueCondition().ok()?;
        let elements = root.FindAll(TreeScope_Descendants, &condition).ok()?;
        for index in 0..elements.Length().ok()?.min(2000) {
            let Ok(element) = elements.GetElement(index) else {
                continue;
            };
            if let Ok(name) = element.CurrentName() {
                if let Some(pair) = progress_pair(&name.to_string()) {
                    return Some(pair);
                }
            }
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                if let Ok(value) = pattern.CurrentValue() {
                    if let Some(pair) = progress_pair(&value.to_string()) {
                        return Some(pair);
                    }
                }
            }
        }
        None
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn source_is_player(source: &str) -> bool {
    let value = source.to_lowercase();
    value.contains("qqmusic") || value.contains("cloudmusic") || value.contains("netease")
}

fn audible_processes() -> windows::core::Result<HashSet<u32>> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let mut result = HashSet::new();
        let mut meters = Vec::new();
        for device_index in 0..devices.GetCount()? {
            let device = devices.Item(device_index)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = manager.GetSessionEnumerator()?;
            for session_index in 0..sessions.GetCount()? {
                let control = sessions.GetSession(session_index)?;
                let Ok(info) = control.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(meter) = control.cast::<IAudioMeterInformation>() else {
                    continue;
                };
                if let Ok(pid) = info.GetProcessId() {
                    meters.push((pid, meter));
                }
            }
        }
        // A single sample frequently lands between notes. A short window is still
        // fast enough for polling and makes QQ/NetEase activity detection stable.
        for sample in 0..5 {
            for (pid, meter) in &meters {
                if meter.GetPeakValue().unwrap_or(0.0) > 0.00001 {
                    result.insert(*pid);
                }
            }
            if sample < 4 {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        Ok(result)
    }
}

unsafe extern "system" fn collect_player_window(hwnd: HWND, data: LPARAM) -> BOOL {
    let windows = unsafe { &mut *(data.0 as *mut Vec<(u32, String, String, HWND)>) };
    let mut title_buffer = [0u16; 1024];
    let title_length = unsafe { GetWindowTextW(hwnd, &mut title_buffer) };
    if title_length <= 0 {
        return true.into();
    }
    let title = String::from_utf16_lossy(&title_buffer[..title_length as usize]);
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if let Ok(process) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let mut path_buffer = [0u16; 2048];
        let mut path_length = path_buffer.len() as u32;
        let queried = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(path_buffer.as_mut_ptr()),
                &mut path_length,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        if queried.is_ok() {
            let path = String::from_utf16_lossy(&path_buffer[..path_length as usize]);
            let name = path.rsplit('\\').next().unwrap_or("").to_lowercase();
            if matches!(name.as_str(), "cloudmusic.exe" | "qqmusic.exe") {
                windows.push((pid, name, title, hwnd));
            }
        }
    }
    true.into()
}

fn thumbnail_data_url(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let stream = properties
        .Thumbnail()
        .ok()?
        .OpenReadAsync()
        .ok()?
        .join()
        .ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > 8 * 1024 * 1024 || size > u32::MAX as u64 {
        return None;
    }
    let input = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    reader.LoadAsync(size as u32).ok()?.join().ok()?;
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let reported_type = stream.ContentType().ok()?.to_string();
    let content_type = reported_type
        .split(',')
        .next()
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/jpeg");
    Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(bytes)
    ))
}

fn media_sessions(include_artwork: bool) -> Result<Vec<Value>, String> {
    let manager = Manager::RequestAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows media session access failed: {error}"))?;
    let sessions = manager
        .GetSessions()
        .map_err(|error| format!("Windows media session enumeration failed: {error}"))?;
    let mut tracks = Vec::new();
    for session in sessions {
        let Ok(properties) = session
            .TryGetMediaPropertiesAsync()
            .and_then(|operation| operation.join())
        else {
            continue;
        };
        let title = properties.Title().unwrap_or_default().to_string();
        if title.trim().is_empty() {
            continue;
        }
        let playback = session.GetPlaybackInfo().ok();
        let playback_status = playback
            .as_ref()
            .and_then(|value| value.PlaybackStatus().ok());
        let status = match playback_status {
            Some(Status::Playing) => "playing",
            Some(Status::Paused) => "paused",
            Some(Status::Stopped | Status::Closed) => "stopped",
            _ => "unknown",
        };
        let rate = playback
            .as_ref()
            .and_then(|value| value.PlaybackRate().ok())
            .and_then(|value| value.Value().ok())
            .filter(|value| value.is_finite())
            .unwrap_or(1.0);
        let controls = playback.as_ref().and_then(|value| value.Controls().ok());
        let shuffle_active = playback
            .as_ref()
            .and_then(|value| value.IsShuffleActive().ok())
            .and_then(|value| value.Value().ok());
        let repeat_mode = playback
            .as_ref()
            .and_then(|value| value.AutoRepeatMode().ok())
            .and_then(|value| value.Value().ok())
            .map(|value| match value {
                MediaPlaybackAutoRepeatMode::None => "none",
                MediaPlaybackAutoRepeatMode::Track => "track",
                MediaPlaybackAutoRepeatMode::List => "list",
                _ => "unknown",
            })
            .unwrap_or("unknown");
        let track_id = properties.Genres().ok().and_then(|genres| {
            (0..genres.Size().ok()?).find_map(|index| {
                let value = genres.GetAt(index).ok()?.to_string();
                let upper = value.to_uppercase();
                (upper.starts_with("NCM-") || upper.starts_with("QQ-")).then_some(value)
            })
        });
        let timeline = session.GetTimelineProperties().ok();
        let duration_ms = timeline
            .as_ref()
            .and_then(|value| value.EndTime().ok())
            .map(|value| value.Duration / 10_000)
            .filter(|value| *value > 0);
        let raw_position = timeline
            .as_ref()
            .and_then(|value| value.Position().ok())
            .map(|value| value.Duration / 10_000)
            .filter(|value| *value >= 0 && (*value > 0 || duration_ms.is_some()));
        let updated_at = timeline
            .as_ref()
            .and_then(|value| value.LastUpdatedTime().ok())
            .map(|value| value.UniversalTime / 10_000 - 11_644_473_600_000);
        let position_ms = raw_position.map(|position| {
            let age = updated_at
                .map(|value| (now_ms() - value).max(0))
                .unwrap_or(0);
            let estimated = if status == "playing" {
                position + (age as f64 * rate) as i64
            } else {
                position
            };
            duration_ms
                .map(|duration| estimated.min(duration))
                .unwrap_or(estimated)
        });
        tracks.push(json!({
            "title": title,
            "artist": properties.Artist().unwrap_or_default().to_string(),
            "album": properties.AlbumTitle().unwrap_or_default().to_string(),
            "trackId": track_id.unwrap_or_default(),
            "artworkUrl": if include_artwork { thumbnail_data_url(&properties) } else { None },
            "sourceAppId": session.SourceAppUserModelId().unwrap_or_default().to_string(),
            "status": status,
            "positionMs": position_ms,
            "durationMs": duration_ms,
            "playbackRate": rate,
            "shuffleActive": shuffle_active,
            "repeatMode": repeat_mode,
            "controls": {
                "play": controls.as_ref().and_then(|value| value.IsPlayEnabled().ok()).unwrap_or(false),
                "pause": controls.as_ref().and_then(|value| value.IsPauseEnabled().ok()).unwrap_or(false),
                "previous": controls.as_ref().and_then(|value| value.IsPreviousEnabled().ok()).unwrap_or(false),
                "next": controls.as_ref().and_then(|value| value.IsNextEnabled().ok()).unwrap_or(false),
                "seek": controls.as_ref().and_then(|value| value.IsPlaybackPositionEnabled().ok()).unwrap_or(false),
                "shuffle": controls.as_ref().and_then(|value| value.IsShuffleEnabled().ok()).unwrap_or(false),
                "repeat": controls.as_ref().and_then(|value| value.IsRepeatEnabled().ok()).unwrap_or(false),
            },
            "positionSource": if position_ms.is_some() { "system" } else { "unavailable" },
            "detectedBy": "smtc",
            "sampledAt": now_ms(),
        }));
    }
    Ok(tracks)
}

fn snapshot(include_artwork: bool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let mut tracks = match media_sessions(include_artwork) {
        Ok(value) => value,
        Err(error) => {
            warnings.push(error);
            Vec::new()
        }
    };
    let audible = audible_processes().unwrap_or_default();
    let mut windows: Vec<(u32, String, String, HWND)> = Vec::new();
    let _ = unsafe {
        EnumWindows(
            Some(collect_player_window),
            LPARAM(&mut windows as *mut _ as isize),
        )
    };
    for (pid, app_id, window_title, hwnd) in windows {
        let source_key = app_id.trim_end_matches(".exe");
        let is_audible = audible.contains(&pid);
        if let Some(track) = tracks.iter_mut().find(|track| {
            track["sourceAppId"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(source_key)
        }) {
            // UI Automation can take close to a second on QQ Music. Only scan
            // its progress controls while that player is active; a paused QQ
            // window must not delay NetEase snapshots.
            if track["positionMs"].is_null()
                && (is_audible || track["status"].as_str() == Some("playing"))
            {
                if let Some((position, duration)) = accessible_progress(hwnd) {
                    track["positionMs"] = json!(position);
                    track["durationMs"] = json!(duration);
                    track["positionSource"] = json!("accessibility");
                    track["sampledAt"] = json!(now_ms());
                }
            }
            if is_audible {
                track["status"] = json!("playing");
            } else if track["status"] == "unknown" {
                // A known player window with a current track and no audible
                // output is the best available paused signal when SMTC omits
                // playback state (common with QQ Music and NetEase).
                track["status"] = json!("paused");
            }
        } else {
            let Some((title, artist)) = window_title.rsplit_once(" - ") else {
                continue;
            };
            let progress = is_audible.then(|| accessible_progress(hwnd)).flatten();
            tracks.push(json!({
                "title": title.trim(),
                "artist": artist.trim(),
                "album": "",
                "trackId": "",
                "artworkUrl": "",
                "sourceAppId": app_id,
                "status": if is_audible { "playing" } else { "paused" },
                "positionMs": progress.map(|value| value.0),
                "durationMs": progress.map(|value| value.1),
                "playbackRate": 1.0,
                "shuffleActive": null,
                "repeatMode": "unknown",
                "controls": {
                    "play": false, "pause": false, "previous": false, "next": false,
                    "seek": false, "shuffle": false, "repeat": false
                },
                "positionSource": if progress.is_some() { "accessibility" } else { "unavailable" },
                "detectedBy": "window",
                "sampledAt": now_ms(),
            }));
        }
    }
    tracks.sort_by_key(|track| {
        let source = track["sourceAppId"].as_str().unwrap_or("");
        let status = track["status"].as_str().unwrap_or("unknown");
        let player = source_is_player(source);
        match (status, player) {
            ("playing", true) => 0,
            ("playing", false) => 1,
            ("paused", true) => 2,
            ("unknown", true) => 3,
            _ => 4,
        }
    });
    Ok(json!({ "sessions": tracks, "warnings": warnings }))
}

#[cfg(test)]
mod tests {
    use super::progress_pair;

    #[test]
    fn accepts_only_explicit_playback_clocks() {
        assert_eq!(progress_pair("01:23 / 04:56"), Some((83_000, 296_000)));
        assert_eq!(progress_pair("0:00/1:02:03"), Some((0, 3_723_000)));
        for value in [
            "50%",
            "音量 50/100",
            "04:56",
            "05:00/04:00",
            "00:99/04:00",
            "1/2",
        ] {
            assert_eq!(progress_pair(value), None);
        }
    }
}

pub fn get(include_artwork: bool) -> Result<Value, String> {
    std::thread::spawn(move || {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|error| format!("Windows COM initialization failed: {error}"))?;
        let result = snapshot(include_artwork);
        unsafe { CoUninitialize() };
        result
    })
    .join()
    .map_err(|_| "Windows media session thread failed".to_string())?
}

fn control_session(
    source_app_id: &str,
    action: &str,
    position_ms: Option<i64>,
    enabled: Option<bool>,
    repeat_mode: Option<&str>,
) -> Result<Value, String> {
    let manager = Manager::RequestAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows media session access failed: {error}"))?;
    let sessions = manager
        .GetSessions()
        .map_err(|error| format!("Windows media session enumeration failed: {error}"))?;
    let session = sessions
        .into_iter()
        .find(|session| {
            session
                .SourceAppUserModelId()
                .ok()
                .is_some_and(|value| value.to_string().eq_ignore_ascii_case(source_app_id))
        })
        .ok_or_else(|| "The selected media session is no longer available".to_string())?;
    let acknowledged = match action {
        "play" => session
            .TryPlayAsync()
            .and_then(|operation| operation.join()),
        "pause" => session
            .TryPauseAsync()
            .and_then(|operation| operation.join()),
        "previous" => session
            .TrySkipPreviousAsync()
            .and_then(|operation| operation.join()),
        "next" => session
            .TrySkipNextAsync()
            .and_then(|operation| operation.join()),
        "seek" => {
            let value = position_ms
                .filter(|value| *value >= 0)
                .ok_or_else(|| "A valid playback position is required".to_string())?;
            session
                .TryChangePlaybackPositionAsync(value.saturating_mul(10_000))
                .and_then(|operation| operation.join())
        }
        "set-shuffle" => {
            let value = enabled.ok_or_else(|| "A shuffle state is required".to_string())?;
            session
                .TryChangeShuffleActiveAsync(value)
                .and_then(|operation| operation.join())
        }
        "set-repeat" => {
            let value = match repeat_mode {
                Some("none") => MediaPlaybackAutoRepeatMode::None,
                Some("track") => MediaPlaybackAutoRepeatMode::Track,
                Some("list") => MediaPlaybackAutoRepeatMode::List,
                _ => return Err("A valid repeat mode is required".into()),
            };
            session
                .TryChangeAutoRepeatModeAsync(value)
                .and_then(|operation| operation.join())
        }
        "cycle-repeat" => session
            // NetEase/InfLink treats a repeat change as a request to advance
            // its combined playback-mode button and ignores the supplied mode.
            .TryChangeAutoRepeatModeAsync(MediaPlaybackAutoRepeatMode::List)
            .and_then(|operation| operation.join()),
        "toggle-shuffle" => session
            // InfLink maps this change request to its internal toggleShuffle.
            .TryChangeShuffleActiveAsync(true)
            .and_then(|operation| operation.join()),
        _ => return Err("Unsupported media control action".into()),
    }
    .map_err(|error| format!("Windows media control failed: {error}"))?;
    Ok(json!({ "acknowledged": acknowledged }))
}

pub fn control(
    source_app_id: &str,
    action: &str,
    position_ms: Option<i64>,
    enabled: Option<bool>,
    repeat_mode: Option<&str>,
) -> Result<Value, String> {
    let source = source_app_id.to_string();
    let action = action.to_string();
    let repeat = repeat_mode.map(str::to_string);
    std::thread::spawn(move || {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|error| format!("Windows COM initialization failed: {error}"))?;
        let result = control_session(&source, &action, position_ms, enabled, repeat.as_deref());
        unsafe { CoUninitialize() };
        result
    })
    .join()
    .map_err(|_| "Windows media control thread failed".to_string())?
}

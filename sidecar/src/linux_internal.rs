use ddc_hi::Display;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone)]
struct Backlight {
    name: String,
    kind: BacklightKind,
    current: u32,
    maximum: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum BacklightKind {
    Raw,
    Platform,
    Firmware,
    Unknown,
}

struct Panel {
    backlight: Backlight,
    connector: PathBuf,
    native_display: Option<usize>,
}

pub struct InternalPanelInfo {
    pub native_display: Option<usize>,
    pub id: String,
}

fn read_u32(path: &Path) -> Result<u32, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    text.trim()
        .parse::<u32>()
        .map_err(|_| format!("invalid integer in {}", path.display()))
}

fn read_backlight_kind(directory: &Path) -> BacklightKind {
    match fs::read_to_string(directory.join("type")) {
        Ok(value) => match value.trim() {
            "raw" => BacklightKind::Raw,
            "platform" => BacklightKind::Platform,
            "firmware" => BacklightKind::Firmware,
            _ => BacklightKind::Unknown,
        },
        Err(_) => BacklightKind::Unknown,
    }
}

fn backlights() -> Vec<Backlight> {
    let entries = match fs::read_dir("/sys/class/backlight") {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    let mut backlights = entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let directory = Path::new("/sys/class/backlight").join(&name);
            let maximum = read_u32(&directory.join("max_brightness")).ok()?;
            if maximum == 0 {
                return None;
            }
            let current = read_u32(&directory.join("brightness")).ok()?;
            Some(Backlight {
                name,
                kind: read_backlight_kind(&directory),
                current,
                maximum,
            })
        })
        .collect::<Vec<_>>();
    backlights.sort_by(|left, right| (left.kind, &left.name).cmp(&(right.kind, &right.name)));
    backlights
}

fn internal_connector_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("-edp-") || name.contains("-lvds-") || name.contains("-dsi-")
}

fn backlight_connector(backlight: &Backlight) -> Option<PathBuf> {
    let path = fs::canonicalize(Path::new("/sys/class/backlight").join(&backlight.name)).ok()?;
    path.ancestors()
        .find(|path| {
            let Some(name) = path.file_name() else {
                return false;
            };
            internal_connector_name(&name.to_string_lossy())
        })
        .map(Path::to_path_buf)
}

fn connected_internal_connectors() -> Vec<PathBuf> {
    let entries = match fs::read_dir("/sys/class/drm") {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut connectors = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            let Some(name) = path.file_name() else {
                return false;
            };
            internal_connector_name(&name.to_string_lossy())
        })
        .filter(|path| {
            fs::read_to_string(path.join("status"))
                .map(|status| status.trim() == "connected")
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    connectors.sort();
    connectors
}

fn connector_edid(connector: &Path) -> Option<Vec<u8>> {
    fs::read(connector.join("edid"))
        .ok()
        .filter(|edid| !edid.is_empty())
}

fn edid_matches(panel_edid: &[u8], display_edid: Option<&Vec<u8>>) -> bool {
    let Some(display_edid) = display_edid else {
        return false;
    };
    !display_edid.is_empty()
        && panel_edid.len() >= display_edid.len()
        && panel_edid[..display_edid.len()] == display_edid[..]
}

fn panels_for(displays: &[Display]) -> Vec<Panel> {
    let backlights = backlights();
    if backlights.is_empty() {
        return Vec::new();
    }
    let connectors = connected_internal_connectors();
    let fallback_backlight = if connectors.len() == 1 {
        backlights.first().cloned()
    } else {
        None
    };
    connectors
        .into_iter()
        .filter_map(|connector| {
            let linked = backlights
                .iter()
                .filter(|backlight| {
                    backlight_connector(backlight).as_deref() == Some(connector.as_path())
                })
                .min_by_key(|backlight| (backlight.kind, backlight.name.clone()))
                .cloned();
            let backlight = linked.or(fallback_backlight.clone())?;
            let native_display = connector_edid(&connector).and_then(|edid| {
                displays
                    .iter()
                    .position(|display| edid_matches(&edid, display.info.edid_data.as_ref()))
                    .map(|index| index + 1)
            });
            Some(Panel {
                backlight,
                connector,
                native_display,
            })
        })
        .collect()
}

pub fn panels() -> Vec<InternalPanelInfo> {
    panels_for(&Display::enumerate())
        .into_iter()
        .map(|panel| {
            let connector = panel
                .connector
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "internal-panel".into());
            InternalPanelInfo {
                native_display: panel.native_display,
                id: format!("internal-panel:{connector}:{}", panel.backlight.name),
            }
        })
        .collect()
}

fn panel_for_display(display: usize) -> Result<Panel, String> {
    let displays = Display::enumerate();
    let native_count = displays.len();
    let mut appended_count = 0;
    for panel in panels_for(&displays) {
        if let Some(index) = panel.native_display {
            if index == display {
                return Ok(panel);
            }
            continue;
        }
        appended_count += 1;
        if native_count + appended_count == display {
            return Ok(panel);
        }
    }
    Err(format!("internal panel {display} was not found"))
}

pub fn probe() -> Result<Value, String> {
    let count = panels().len();
    Ok(json!({
        "transport": "internal-panel",
        "system": "linux",
        "brightness": "sysfs",
        "count": count,
    }))
}

pub fn get(display: usize, vcp: u8) -> Result<Value, String> {
    match vcp {
        0x10 => {}
        0x62 | 0x8d => {
            panel_for_display(display)?;
            return audio(vcp, None);
        }
        _ => return Err("internal-panel does not support this control".into()),
    }
    let panel = panel_for_display(display)?;
    let current = panel.backlight.current * 100 / panel.backlight.maximum;
    Ok(json!({
        "driver": "sysfs-backlight",
        "id": panel.backlight.name,
        "system": "linux",
        "vcp": 0x10,
        "maximum": 100,
        "current": current,
    }))
}

pub fn set(display: usize, vcp: u8, value: u16) -> Result<Value, String> {
    match vcp {
        0x10 => {}
        0x62 | 0x8d => {
            panel_for_display(display)?;
            return audio(vcp, Some(value));
        }
        _ => return Err("internal-panel does not support this control".into()),
    }
    if value > 100 {
        return Err("internal-panel brightness must be 0-100".into());
    }
    let panel = panel_for_display(display)?;
    let backlight = panel.backlight;
    let raw = u32::from(value) * backlight.maximum / 100;
    set_backlight(&backlight, raw)?;
    Ok(json!({
        "vcp": 0x10,
        "value": value,
        "system": "linux",
        "acknowledged": true,
    }))
}

fn set_backlight(backlight: &Backlight, raw: u32) -> Result<(), String> {
    let path = Path::new("/sys/class/backlight")
        .join(&backlight.name)
        .join("brightness");
    if fs::write(&path, raw.to_string()).is_ok() {
        return Ok(());
    }
    if set_gnome_brightness(raw, backlight) {
        return Ok(());
    }
    if set_logind_brightness(backlight, raw) {
        return Ok(());
    }
    Err(format!(
        "failed to set Linux internal panel brightness: {} is not writable and no desktop brightness service was available",
        path.display()
    ))
}

fn set_gnome_brightness(raw: u32, backlight: &Backlight) -> bool {
    let percentage = raw * 100 / backlight.maximum.max(1);
    Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.gnome.SettingsDaemon.Power",
            "--object-path",
            "/org/gnome/SettingsDaemon/Power",
            "--method",
            "org.freedesktop.DBus.Properties.Set",
            "org.gnome.SettingsDaemon.Power.Screen",
            "Brightness",
        ])
        .arg(format!("<int32 {percentage}>"))
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn set_logind_brightness(backlight: &Backlight, raw: u32) -> bool {
    Command::new("busctl")
        .args([
            "call",
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            "SetBrightness",
            "ssu",
            "backlight",
        ])
        .arg(&backlight.name)
        .arg(raw.to_string())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_pactl(arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("pactl")
        .env("LC_ALL", "C")
        .args(arguments)
        .output()
        .map_err(|error| format!("failed to start pactl: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("pactl exited with {}", output.status)
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_percentage(output: &str) -> Result<u16, String> {
    let end = output
        .find('%')
        .ok_or_else(|| "pactl did not report a volume percentage".to_string())?;
    let before = &output[..end];
    let start = before
        .rfind(|character: char| !character.is_ascii_digit())
        .map_or(0, |index| index + 1);
    before[start..]
        .parse::<u16>()
        .map_err(|_| "pactl reported an invalid volume percentage".to_string())
}

pub fn audio(vcp: u8, value: Option<u16>) -> Result<Value, String> {
    match (vcp, value) {
        (0x62, None | Some(0..=100)) | (0x8d, None | Some(1..=2)) => {}
        _ => return Err("system audio requires volume 0-100 or mute 1 (on)/2 (off)".into()),
    }
    if let Some(value) = value {
        if vcp == 0x62 {
            run_pactl(&["set-sink-volume", "@DEFAULT_SINK@", &format!("{value}%")])?;
        } else {
            run_pactl(&[
                "set-sink-mute",
                "@DEFAULT_SINK@",
                if value == 1 { "1" } else { "0" },
            ])?;
        }
        return Ok(json!({
            "driver": "pipewire",
            "vcp": vcp,
            "value": value,
            "acknowledged": true,
        }));
    }
    if vcp == 0x62 {
        let current = parse_percentage(&run_pactl(&["get-sink-volume", "@DEFAULT_SINK@"])?)?;
        Ok(json!({
            "driver": "pipewire",
            "vcp": vcp,
            "current": current,
            "maximum": 100,
        }))
    } else {
        let output = run_pactl(&["get-sink-mute", "@DEFAULT_SINK@"])?;
        let muted = output.contains("Mute: yes");
        Ok(json!({
            "driver": "pipewire",
            "vcp": vcp,
            "current": if muted { 1 } else { 2 },
            "maximum": 2,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_connectors_cover_edp_lvds_and_dsi() {
        assert!(internal_connector_name("card0-eDP-1"));
        assert!(internal_connector_name("card0-LVDS-1"));
        assert!(internal_connector_name("card0-DSI-1"));
        assert!(!internal_connector_name("card0-DP-1"));
        assert!(!internal_connector_name("card0-HDMI-A-1"));
    }

    #[test]
    fn raw_backlights_are_preferred_over_platform_and_firmware() {
        assert!(BacklightKind::Raw < BacklightKind::Platform);
        assert!(BacklightKind::Platform < BacklightKind::Firmware);
        assert!(BacklightKind::Firmware < BacklightKind::Unknown);
    }

    #[test]
    fn edid_matching_uses_a_nonempty_prefix() {
        let panel_edid = vec![1, 2, 3, 4];
        assert!(edid_matches(&panel_edid, Some(&vec![1, 2, 3, 4])));
        assert!(edid_matches(&panel_edid, Some(&vec![1, 2, 3])));
        assert!(!edid_matches(&panel_edid, Some(&vec![1, 2, 4])));
        assert!(!edid_matches(&panel_edid, Some(&Vec::new())));
        assert!(!edid_matches(&panel_edid, None));
    }

    #[test]
    fn parses_the_first_volume_percentage() {
        let output = "Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB\n";
        assert_eq!(parse_percentage(output).unwrap(), 50);
    }
}

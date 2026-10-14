use ddc_hi::DisplayInfo;

// Parse only VCP 0x60. Some otherwise usable displays include malformed vendor
// extensions, which must not discard the standard input-source capability.
pub fn input_capability(bytes: &[u8]) -> Option<(bool, Vec<u16>)> {
    feature_capability(bytes, 0x60)
}

pub fn feature_capability(bytes: &[u8], feature: u8) -> Option<(bool, Vec<u16>)> {
    let wanted = format!("{feature:02x}");
    let text = std::str::from_utf8(bytes).ok()?.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let start = text.find("vcp(")? + 4;
    let mut position = start;
    while position < bytes.len() {
        while bytes.get(position).is_some_and(u8::is_ascii_whitespace) {
            position += 1;
        }
        if bytes.get(position) == Some(&b')') {
            return Some((false, Vec::new()));
        }
        let code = text.get(position..position + 2)?;
        if !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        position += 2;
        while bytes.get(position).is_some_and(u8::is_ascii_whitespace) {
            position += 1;
        }
        let mut values = Vec::new();
        if bytes.get(position) == Some(&b'(') {
            let value_start = position + 1;
            let mut depth = 1;
            position += 1;
            while depth > 0 {
                match bytes.get(position)? {
                    b'(' => depth += 1,
                    b')' => depth -= 1,
                    _ => {}
                }
                position += 1;
            }
            if code == wanted {
                for value in text[value_start..position - 1].split_ascii_whitespace() {
                    if value.len() > 4 {
                        return None;
                    }
                    values.push(u16::from_str_radix(value, 16).ok()?);
                }
            }
        }
        if code == wanted {
            return Some((true, values));
        }
    }
    None
}

pub fn display_connection(info: &DisplayInfo) -> (Option<String>, Option<String>) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let matches = std::fs::read_dir("/sys/class/drm")
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|entry| {
                std::fs::read_to_string(entry.path().join("status"))
                    .is_ok_and(|value| value.trim() == "connected")
            })
            .filter(|entry| {
                let Ok(ddc) = std::fs::canonicalize(entry.path().join("ddc")) else {
                    return false;
                };
                let Some(bus) = ddc.file_name() else {
                    return false;
                };
                std::fs::metadata(std::path::Path::new("/dev").join(bus))
                    .is_ok_and(|metadata| metadata.rdev().to_string() == info.id)
            })
            .collect::<Vec<_>>();
        if matches.len() == 1 {
            let entry = &matches[0];
            let name = entry.file_name().to_string_lossy().into_owned();
            let connector = name.split_once('-').map(|(_, value)| value.to_owned());
            let connection = if entry.path().join("typec_connector").exists() {
                Some("usbc".to_owned())
            } else {
                None
            };
            return (connector, connection);
        }
    }
    let _ = info;
    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_standard_inputs_despite_malformed_vendor_extensions() {
        assert_eq!(
            input_capability(b"(vcp(10 12(01 05) 60( 11 12 0F) F8E112(000102)))"),
            Some((true, vec![17, 18, 15]))
        );
        assert_eq!(
            input_capability(b"(vcp(F8E112(000102) 60(1B) 10))"),
            Some((true, vec![27]))
        );
    }

    #[test]
    fn distinguishes_absent_inputs_from_unreadable_capabilities() {
        assert_eq!(
            input_capability(b"(model(RTK)vcp(02))"),
            Some((false, vec![]))
        );
        assert_eq!(input_capability(b"(vcp(10 60))"), Some((true, vec![])));
        assert_eq!(input_capability(b"garbage"), None);
        assert_eq!(input_capability(b"(vcp(10"), None);
        assert_eq!(input_capability(b"(vcp(60(11"), None);
    }
}

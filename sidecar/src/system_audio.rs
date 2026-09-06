use serde_json::{Value, json};
use windows::Win32::Media::Audio::{
    Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn access(vcp: u8, value: Option<u16>) -> Result<Value, String> {
    match (vcp, value) {
        (0x62, None | Some(0..=100)) | (0x8d, None | Some(1..=2)) => {}
        _ => return Err("system audio requires volume 0-100 or mute 1 (on)/2 (off)".into()),
    }
    // WMI owns COM initialization on the caller thread. Keep audio in its own
    // apartment, and release all interfaces before balancing CoInitializeEx.
    std::thread::spawn(move || -> windows::core::Result<Value> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            let _apartment = ComApartment;
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            // Resolve each time so changes to the default output are respected.
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            if let Some(value) = value {
                if vcp == 0x62 {
                    endpoint.SetMasterVolumeLevelScalar(f32::from(value) / 100.0, std::ptr::null())?;
                } else {
                    endpoint.SetMute(value == 1, std::ptr::null())?;
                }
                Ok(json!({ "driver": "wasapi", "vcp": vcp, "value": value, "acknowledged": true }))
            } else {
                let current = if vcp == 0x62 {
                    (endpoint.GetMasterVolumeLevelScalar()? * 100.0).round() as u16
                } else if endpoint.GetMute()?.as_bool() { 1 } else { 2 };
                Ok(json!({ "driver": "wasapi", "vcp": vcp, "current": current, "maximum": if vcp == 0x62 { 100 } else { 2 } }))
            }
        }
    }).join().map_err(|_| "Windows system audio thread failed".to_string())?
        .map_err(|error| format!("Windows system audio failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_controls_are_rejected_before_accessing_audio() {
        for (vcp, value) in [
            (0x60, None),
            (0x62, Some(101)),
            (0x8d, Some(0)),
            (0x8d, Some(3)),
        ] {
            assert!(
                access(vcp, value)
                    .unwrap_err()
                    .contains("system audio requires")
            );
        }
    }
}

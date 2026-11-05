//! Sample the desktop's default output away from the UI thread.
use std::{process::Command, sync::mpsc::{self, Receiver, Sender}, time::Duration};

pub enum Action { Volume(u32), ToggleMute }

fn output(args: &[&str]) -> Option<String> {
    let out = Command::new("pactl").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}
fn parse(volume: &str, mute: &str) -> Option<(u32, bool)> {
    let percent = volume.split_whitespace().find_map(|part| part.strip_suffix('%')?.parse::<u32>().ok())?;
    let muted = match mute.trim().strip_prefix("Mute:")?.trim() { "yes" => true, "no" => false, _ => return None };
    Some((percent.min(100), muted))
}
pub fn start(ctx: eframe::egui::Context) -> (Receiver<Option<(u32, bool)>>, Sender<Action>) {
    let (tx, rx) = mpsc::sync_channel(1);
    let (command_tx, command_rx) = mpsc::channel();
    std::thread::spawn(move || {
        while let Ok(action) = command_rx.recv() {
            match action {
                Action::Volume(value) => {
                    let _ = Command::new("pactl").args(["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", value.min(100))]).status();
                    let _ = Command::new("pactl").args(["set-sink-mute", "@DEFAULT_SINK@", "0"]).status();
                }
                Action::ToggleMute => { let _ = Command::new("pactl").args(["set-sink-mute", "@DEFAULT_SINK@", "toggle"]).status(); }
            }
        }
    });
    std::thread::spawn(move || loop {
        let value = output(&["get-sink-volume", "@DEFAULT_SINK@"]).zip(output(&["get-sink-mute", "@DEFAULT_SINK@"]))
            .and_then(|(volume, mute)| parse(&volume, &mute));
        match tx.try_send(value) {
            Ok(()) => ctx.request_repaint(),
            Err(mpsc::TrySendError::Disconnected(_)) => break,
            Err(mpsc::TrySendError::Full(_)) => {},
        }
        std::thread::sleep(Duration::from_secs(2));
    });
    (rx, command_tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_default_sink_and_handles_missing_data() {
        assert_eq!(parse("Volume: front-left: 32768 / 50% / -18.06 dB", "Mute: no"), Some((50, false)));
        assert_eq!(parse("Volume: front-left: 65536 / 100%", "Mute: yes"), Some((100, true)));
        assert_eq!(parse("no output", "Mute: no"), None);
    }
}

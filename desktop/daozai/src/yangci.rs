//! Private stdio bridge to the YangCi parent process.
use base64::Engine;
use daozai::{app::DisplayStatus, lyrics::{Lyrics, LyricsLine}, smtc::{MediaKind, NowPlaying, Transport}};
use eframe::egui;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::Instant;

pub struct Bridge {
    rx: Receiver<Value>,
    pub display: DisplayStatus,
    pub media: NowPlaying,
    pub usage: Value,
    pub error: Option<String>,
    pub settings_requested: bool,
    pub autostart: Option<bool>,
    artwork_key: String,
}
impl Bridge {
    pub fn start(ctx: egui::Context) -> Self {
        let (tx,rx)=mpsc::channel();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line)=line else {break};
                if line.len()>12_000_000 {continue;}
                if let Ok(value)=serde_json::from_str::<Value>(&line) {if tx.send(value).is_err(){return;} ctx.request_repaint();}
            }
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            ctx.request_repaint();
        });
        Self { rx, display: DisplayStatus { name:"等待 YangCi".into(), ..Default::default() }, media: NowPlaying::default(), usage: Value::Null, error:None, settings_requested:false, autostart:None, artwork_key: String::new() }
    }
    pub fn poll(&mut self) -> Option<Lyrics> {
        let mut latest=None;
        while let Ok(value)=self.rx.try_recv(){if let Some(error)=value["error"].as_str(){self.error=Some(error.to_string());}else if value["command"].as_str()==Some("open-settings"){self.settings_requested=true;}else{latest=Some(value);}}
        let value=latest?;
        self.usage=value["usage"].clone();
        self.autostart=value["startAtLogin"].as_bool();
        let monitor=&value["monitor"];
        self.display=DisplayStatus { name:value["monitorName"].as_str().unwrap_or("显示器").to_string(),
            brightness:monitor["brightness"].as_u64().unwrap_or(0).min(100) as u32,
            volume:monitor["volume"].as_u64().unwrap_or(0).min(100) as u32,
            available:value["monitorAvailable"].as_bool().unwrap_or(false),
            api_balance:if self.usage["usageApiAvailable"].as_bool().unwrap_or(false) {format!("{} 余额 {}{} {}{}",self.usage["usageApiName"].as_str().unwrap_or("API"),self.usage["usageApiCompact"].as_str().unwrap_or("--"),self.usage["usageApiScale"].as_str().unwrap_or(""),self.usage["usageApiUnit"].as_str().unwrap_or(""),if self.usage["usageApiStale"].as_bool().unwrap_or(false){" · 数据较旧"}else{""})} else {String::new()} };
        let track=&value["music"]["track"];
        if track.is_null() { self.media=NowPlaying::default(); self.artwork_key.clear(); return Some(Lyrics::default()); }
        let art=track["artworkUrl"].as_str().unwrap_or("");
        if art!=self.artwork_key {
            self.artwork_key=art.to_string();
            self.media.artwork=art.split_once(',').and_then(|(_,data)|base64::engine::general_purpose::STANDARD.decode(data).ok())
                .and_then(|bytes|image::load_from_memory(&bytes).ok()).map(|image|{
                    let image=image.thumbnail(256,256).to_rgba8();
                    Arc::new(egui::ColorImage::from_rgba_unmultiplied([image.width() as usize,image.height() as usize],image.as_raw()))
                });
        }
        self.media.title=track["title"].as_str().unwrap_or("").to_string();
        self.media.artist=track["artist"].as_str().unwrap_or("").to_string();
        self.media.album=track["album"].as_str().unwrap_or("").to_string();
        self.media.source=track["sourceAppId"].as_str().unwrap_or("").to_string();
        self.media.playing=track["status"].as_str()==Some("playing");
        self.media.position=track["positionMs"].as_f64().unwrap_or(0.0)/1000.0;
        self.media.duration=track["durationMs"].as_f64().unwrap_or(0.0)/1000.0;
        self.media.sampled_at=Some(Instant::now());
        self.media.playback_type=MediaKind::Music;
        let lines=value["music"]["lines"].as_array().into_iter().flatten().filter_map(|line|Some(LyricsLine {t:(line["timeMs"].as_f64()? / 1000.0) as f32,text:line["text"].as_str()?.to_string()})).collect::<Vec<_>>();
        Some(Lyrics {synced:!lines.is_empty(),lines})
    }
    fn send(value: Value) { let mut out=std::io::stdout().lock(); let _=writeln!(out,"{value}"); let _=out.flush(); }
    pub fn display_control(&self, control: &str, value:u32) {Self::send(json!({"type":"monitor","control":control,"value":value}));}
    pub fn notify(&self,title:&str,body:&str,sound:bool) {Self::send(json!({"type":"notification","title":title.chars().take(100).collect::<String>(),"body":body.chars().take(500).collect::<String>(),"sound":sound}));}
    pub fn set_autostart(&self, enabled:bool) {Self::send(json!({"type":"autostart","enabled":enabled}));}
    pub fn media_control(&self, command:Transport, playing:bool) {
        let value=match command {Transport::Toggle=>json!({"action":if playing {"pause"} else {"play"}}),Transport::Prev=>json!({"action":"previous"}),Transport::Next=>json!({"action":"next"}),Transport::Seek(seconds)=>json!({"action":"seek","positionMs":(seconds.max(0.0)*1000.0).round() as u64})};
        Self::send(json!({"type":"music","request":value}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_maps_yangci_media_lyrics_and_display() {
        let (tx,rx)=mpsc::channel();
        let mut bridge=Bridge {rx,display:Default::default(),media:Default::default(),usage:Value::Null,error:None,settings_requested:false,autostart:None,artwork_key:String::new()};
        tx.send(json!({"monitor":{"brightness":63,"volume":24},"monitorName":"外接屏","monitorAvailable":true,
            "usage":{"usageApiAvailable":true,"usageApiName":"API","usageApiCompact":"12.30","usageApiScale":"","usageApiUnit":"元"},
            "startAtLogin":true,"music":{"track":{"title":"歌曲","artist":"歌手","album":"专辑","sourceAppId":"player","status":"playing","positionMs":1200,"durationMs":30000},"lines":[{"timeMs":1000,"text":"第一句"}]}})).unwrap();
        let lyrics=bridge.poll().unwrap();
        assert_eq!(bridge.display.brightness,63);assert_eq!(bridge.display.volume,24);assert_eq!(bridge.display.api_balance,"API 余额 12.30 元");
        assert_eq!(bridge.media.title,"歌曲");assert!(bridge.media.playing);assert_eq!(bridge.media.position,1.2);assert_eq!(bridge.autostart,Some(true));
        assert_eq!(lyrics.lines[0].t,1.0);assert_eq!(lyrics.lines[0].text,"第一句");
        tx.send(json!({"error":"控制失败"})).unwrap();assert!(bridge.poll().is_none());assert_eq!(bridge.error.as_deref(),Some("控制失败"));
        tx.send(json!({"command":"open-settings"})).unwrap();assert!(bridge.poll().is_none());assert!(bridge.settings_requested);
    }
}

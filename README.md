# YangCi

> Origin and thanks: this project started from [ayedaren/azoria](https://github.com/ayedaren/azoria)
> and has since evolved through substantial changes to the desktop app, hardware
> control, and Touch firmware.

<div align="center">

**A local-first control center for modern desktop displays.**

[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-2f80ed.svg)](LICENSE)
[![CI](https://github.com/Yang-Ci/azoria_Pro/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-Ci/azoria_Pro/actions/workflows/ci.yml)
[![Electron](https://img.shields.io/badge/Desktop-Electron-47848f.svg)](https://www.electronjs.org/)
[![ESP32-S3](https://img.shields.io/badge/Touch-ESP32--S3-e7352c.svg)](https://www.espressif.com/en/products/socs/esp32-s3)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

YangCi brings display controls into one desktop experience. It combines an
Electron control center, a native Rust DDC/CI sidecar, and an optional 480×480
ESP32-S3 touch controller called **AZORIA Touch**.

The desktop app works independently; add Touch to keep display controls, music,
lyrics, and wallpapers within reach. Display control and device communication
stay on the host or trusted private network. Online lyric matching and artwork
lookup contact the corresponding music services and require internet access.

## Desktop app

### Display controls

![YangCi desktop: display selection, brightness, audio, input targets, and mute](docs/images/yangci-desktop-control.jpg)

Choose a display, adjust brightness and audio, toggle mute, and select
DisplayPort, HDMI 1, HDMI 2, USB-C, or the laptop's internal panel target. YangCi
probes video-link DDC/CI and vendor USB HID routes and supports built-in or
imported monitor profiles. External-monitor audio and input support depend on
the monitor. For Windows / Linux internal-panel targets, volume and mute control
the system's default playback device, including headphones.

### Music and lyrics

![YangCi desktop: artwork, track information, playback controls, and synchronized lyrics](docs/images/yangci-desktop-music.jpg)

Read track, artist, album, artwork, and playback progress from system media
sessions, with support for NetEase Cloud Music, QQ Music, and other desktop or
browser players that expose media sessions. Match lyrics through NetEase, QQ
Music, or LRCLIB and highlight the current line as playback advances.

Control previous / next, play / pause, seeking, and playback modes where the
player exposes those capabilities. Click a lyric line to seek; when seeking is
unavailable, clicking can calibrate lyric timing. Connected Touch devices receive
track information, lyrics, and playback state.

### Touch setup, wallpaper, and scheduled sleep

![YangCi desktop: Touch connection, Wi-Fi setup, scheduled sleep, and wallpaper](docs/images/yangci-desktop-touch.jpg)

| Feature | What it does |
| --- | --- |
| Device setup | Identify Touch over USB, prepare Bluetooth and connect through BLE; optionally scan and configure 2.4 GHz Wi-Fi over USB for automatic LAN discovery. |
| Still / video wallpaper | Preview the 480×480 crop, adjust its horizontal/vertical position and 1–3× zoom, then save to a local library of up to 100 wallpapers. Preview, display, or delete saved items. TF storage takes priority: videos up to 10 seconds, targeting 25 frames, with a 24 MB package limit; without a card, keep packages under 3 MB. |
| Playlists / scheduled changes | Reorder selected wallpapers, rotate sequentially or randomly at 1-minute to 24-hour intervals, and configure up to 24 daily changes to specific wallpapers. Save settings to apply them. Desktop must stay running and share a LAN with Touch; offline devices retain their last wallpaper. Existing wallpapers migrate automatically. |
| Idle wallpaper | Enter wallpaper after 1, 5, 10, or 30 idle minutes, or disable automatic entry. Tap the wallpaper to return. |
| Scheduled sleep | Configure a backlight-off interval, including overnight schedules; backlight resumes when the interval ends. Disabled by default, with a preset of 23:00–07:00. |
| Diagnostics | View control success rate, average / P95 latency, route failures, readback mismatches, and recent events. |
| Profiles and development | Use the profile wizard or import a profile in Settings. Enable the normally hidden Developer page to select an application firmware image, verify device identity and file hash, and flash over USB. |

## AZORIA Touch interface

![AZORIA Touch normal views: display controls, music, and immersive lyrics](docs/images/azoria-touch-ui-overview.png)

| View | Features and gestures |
| --- | --- |
| Home | Time and connection status, display brightness, audio, mute, and input targets. Swipe down from the top to adjust the small screen's backlight. |
| Music | Tap the **Music** wordmark to see artwork, track information, lyrics, progress, and playback controls. |
| Immersive lyrics | Tap the current lyric to enter a large-text lyric view; tap the page to return to Music. |
| Volume gesture | Swipe down from the top of either music view to adjust volume, synchronized with Home and Desktop. Swipe up or tap × to close and stay on the current page. Home's backlight panel also closes with a swipe up. |
| Wallpaper | Tap the computer icon below Music or wait for the configured idle interval. Tap once to return. |

BLE works independently for everyday controls, track information, and lyrics.
**Artwork and wallpaper synchronization require Touch and Desktop on the same
LAN.** Live playback uses artwork from the player or supported music service;
the documentation's demo cover does not replace live track artwork.

Desktop screenshots render the current React components; Touch screenshots
render the current 480×480 LVGL implementation. Device status, the fictional
track “星夜 / YangCi Demo,” and lyrics are demonstration data, with original demo
artwork. See [screenshot and asset notes](docs/images/README.md).

For the enclosure, print `hardware/enclosure/azoria-touch-all-v3.stl` to produce
the front, rear, and both stand designs on one plate without the fit test coupon.

## Architecture and device capabilities

- Electron + React desktop UI with allowlisted IPC into local services.
- Native Rust sidecar for DDC/CI, LG USB HID/DDC, and supported internal-panel controls.
- Optional Touch controller with independent BLE and private-LAN connections.
- Coordinated command execution across multiple Desktop instances, including duplicate-command suppression.
- Firmware BLE OTA service with size and SHA-256 checks; Desktop provides USB application-image flashing.

## How it fits together

```text
┌─────────────────────────┐       BLE / trusted LAN       ┌──────────────────────┐
│         YangCi          │ ◀───────────────────────────▶ │     AZORIA Touch     │
│  Electron + React UI    │                               │ ESP32-S3 + LVGL UI   │
└────────────┬────────────┘                               └──────────────────────┘
             │ allowlisted IPC
             ▼
┌─────────────────────────┐
│    Rust DDC Sidecar     │
│ DDC/CI + USB HID bridge │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│     External Display    │
│ Brightness · Audio · I/O│
└─────────────────────────┘
```

## Repository layout

```text
azoria-display-control/
├── desktop/
│   ├── profiles/        # Built-in monitor profiles
│   └── src/
│       ├── main/        # Electron main process and hardware orchestration
│       ├── preload/     # Allowlisted IPC bridge
│       ├── renderer/    # React + shadcn/ui interface
│       └── shared/      # Cross-process contracts
├── firmware/
│   ├── assets/          # Source artwork for firmware assets
│   ├── include/         # Board configuration
│   └── src/
│       ├── features/    # AZORIA Touch product features
│       ├── platform/    # Display and touch hardware adapters
│       ├── services/    # Provisioning, BLE, and device configuration
│       └── ui/          # LVGL components and generated assets
└── sidecar/             # Native Rust DDC/CI and USB HID layer
```

## Getting started

### Prerequisites

- Node.js 22 or later
- A stable Rust toolchain
- PlatformIO, only when building AZORIA Touch firmware

### Run the desktop app

```bash
npm install
npm run sidecar:build
npm run dev
```

On first launch, YangCi creates its local key material and device
configuration inside the application data directory. Wi-Fi credentials, local
keys, and device-specific runtime state are not stored in this repository.

### Build the desktop app

```bash
npm run typecheck
npm run build
```

### Build AZORIA Touch firmware

```bash
cd firmware
pio run -e viewe_uedx48480040e_wb_a
```

The application image is written to:

```text
firmware/.pio/build/viewe_uedx48480040e_wb_a/firmware.bin
```

Select this `firmware.bin` from the **Developer** page in YangCi. Do not
select `bootloader.bin` or `partitions.bin`; those files are not accepted by the
Desktop flashing workflow.

To upload directly with PlatformIO (replace the port with your device's port;
for example, `COM7` on Windows):

```bash
cd firmware
pio run -e viewe_uedx48480040e_wb_a -t upload --upload-port /dev/cu.usbmodemXXXX
```

## Hardware status

| Component | Validated hardware |
| --- | --- |
| AZORIA Touch board | VIEWE UEDX48480040E-WB-A V1.3 |
| Display panel | 480×480 GC9503 RGB LCD |
| Touch controller | FT6336U |
| Memory | 16 MB Flash / 8 MB PSRAM |
| External monitor | LG 32UQ85R |

Other monitors may work through standard DDC/CI, but model-specific input codes
and USB HID mappings must be verified on real hardware before being added as a
built-in profile.

## Display transport model

YangCi expresses brightness, volume, mute, and input selection as DDC/CI VCP
features. A monitor can expose those features over either:

- `usb-hid-ddc` — vendor USB HID transport carrying DDC/CI messages;
- `video-ddc` — DDC/CI over HDMI, DisplayPort, or USB-C video links.
- `internal-panel` — native laptop panel controls.

YangCi probes the available transports and selects one verified path for the
entire monitor. It does not mix transport paths between individual controls.
If the active path fails and another path is confirmed, all controls move to
the fallback path together.

The desktop app enumerates DDC/CI-capable displays and native internal panels,
then lets you select the active target in the control view or Profile wizard.
On Windows, brightness reads `WmiMonitorBrightness` and writes through
`WmiSetBrightness`; volume and mute use Core Audio (WASAPI). On Linux, panels are
identified from connected eDP/LVDS/DSI connectors and their system backlight
device, not from monitor model names. Brightness writes try the system backlight
interface and then the desktop's brightness service, while volume and mute use
PipeWire/PulseAudio. Both platforms control the current default playback device
and keep input switching disabled.

Common VCP features:

| Capability | VCP opcode | JSON decimal |
| --- | --- | ---: |
| Brightness | `0x10` | `16` |
| Volume | `0x62` | `98` |
| Mute | `0x8D` | `141` |
| Input source | `0x60` | `96` |

Monitor profiles live in [`desktop/profiles/`](desktop/profiles). They contain
identification rules, transport priority, VCP mappings, and separate input read
and write mappings. Profile files are validated data only: they cannot define
commands, executable paths, dynamic libraries, or network addresses.

### Profile wizard roadmap

| Step | Direction | Status |
| --- | --- | --- |
| 1 | Read the monitor identity and available DDC/CI transports. | Done |
| 2 | Match a validated built-in profile automatically. | Done |
| 3 | Import and validate a custom JSON profile. | Done, basic |
| 4 | Build the interactive step-by-step profile wizard. | Done, first version |
| 5 | Generate a reusable profile file from wizard results. | Planned |
| 6 | Verify on real hardware, then promote it to a built-in or shared profile. | Planned |

See the [Chinese reference](README.zh-CN.md#显示器配置表) for the complete profile
schema and the validated LG 32UQ85R mapping.

## Connectivity and security

- BLE and Wi-Fi can independently connect AZORIA Touch to YangCi.
- LAN coordination uses TCP `8732`, UDP `8733`, and UDP `8734`.
- Network services reject public-source traffic and are intended only for a
  trusted private network.
- The LAN protocol does not provide authentication. Do not expose its ports to
  untrusted networks or the public internet.
- The Electron renderer has no direct Node.js access; hardware operations cross
  an allowlisted IPC boundary.
- Diagnostic logs omit Wi-Fi passwords, local keys, device MAC addresses, and
  complete firmware paths. Logs are stored locally and are not uploaded.

For reporting security issues, see [SECURITY.md](SECURITY.md).

## Development

```bash
npm run typecheck
npm run desktop:build
npm run sidecar:test
```

Contributions that improve monitor compatibility, hardware support, stability,
testing, and documentation are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request.

## License

YangCi is licensed under
[GPL-3.0-or-later](LICENSE). Third-party libraries, hardware names, trademarks,
and artwork remain subject to their respective licenses and rights.

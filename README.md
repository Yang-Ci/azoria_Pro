# YangCi

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

The project is designed to run locally. Display control, Touch discovery, and
coordination stay on the host or trusted private network; no cloud service is
required for normal operation.

## AZORIA Touch

![AZORIA Touch on a desktop control dock](docs/images/azoria-touch-desktop-rec709.jpg)

| Direct touch control | ESP32-S3 prototype hardware |
| --- | --- |
| ![Adjusting display brightness on AZORIA Touch](docs/images/azoria-touch-interaction-rec709.jpg) | ![AZORIA Touch ESP32-S3 controller board](docs/images/azoria-touch-hardware-rec709.jpg) |

The optional Touch controller puts everyday display actions within reach while
the Desktop app handles discovery, coordination, native DDC/CI access, and
firmware management in the background.

When a TF card is available, Touch stores wallpaper packages on the card and
accepts converted videos up to about 20 seconds, 120 frames, and 24 MB. Without
a card it falls back to the onboard data partition and a package limit near
3 MB. For the enclosure, print `hardware/enclosure/azoria-touch-all-v3.stl` to
produce the front, rear, and both stand designs on one plate without the fit
test coupon.

## Why YangCi

- **One control surface** for brightness, volume, mute, and input switching.
- **Real transport probing** across video-link DDC/CI and vendor USB HID paths.
- **Multi-monitor targeting** across enumerated DDC/CI displays.
- **Native hardware access** through a Rust sidecar for macOS, Windows, and Linux.
- **Optional physical controller** with BLE and private-LAN connectivity.
- **TF-card wallpapers** with still images and up to 20 seconds of converted video.
- **Synchronized music view** with lyrics, playback controls, progress, and artwork from desktop or browser players.
- **Resilient coordination** when multiple Desktop instances can reach the same display.
- **Safe firmware workflow** with image type, version, device identity, size, and SHA-256 checks.
- **Declarative monitor profiles** with validated, non-executable configuration.

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

To upload directly with PlatformIO:

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
- Tap the AZORIA logo on Touch to view the current track and control previous,
  play/pause, next, and playback mode through the local network.
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

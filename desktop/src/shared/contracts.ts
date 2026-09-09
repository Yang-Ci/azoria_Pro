export type InputSource = "dp1" | "hdmi1" | "hdmi2" | "usbc"
export type ControlTarget = InputSource | "internal"
export type ControlName = "brightness" | "volume" | "mute" | "input"
export type MonitorTransport = "usb-hid-ddc" | "video-ddc" | "internal-panel" | "unavailable"
export type MonitorSystem = "windows" | "linux"

export interface MonitorStatus {
  brightness: number
  volume: number
  mute: boolean
  input: ControlTarget
  available?: boolean
  wallpaperHash?: string
  wallpaperSize?: number
  wallpaperIdleMinutes?: WallpaperIdleMinutes
}

export interface ControlRequest {
  control: ControlName
  value: number | boolean | ControlTarget
  final?: boolean
}

export interface MonitorConnectionInfo {
  displayId: string
  displayName: string
  profileId: string
  profileName: string
  summary: string
  availableTransports: MonitorTransport[]
  transport: MonitorTransport
}

export interface MonitorDisplaySummary {
  id: string
  index: number
  name: string
  manufacturer?: string
  model?: string
  driver?: string
  system?: MonitorSystem
  transport?: MonitorTransport
}

export interface MonitorDisplayList {
  activeDisplayId: string
  displays: MonitorDisplaySummary[]
}

export type MonitorProfileSource = "built-in" | "user"
export type MonitorProfileMatchState = "selected" | "match" | "fallback" | "available"

export interface MonitorProfileSummary {
  id: string
  name: string
  fallback: boolean
  transports: MonitorTransport[]
  source: MonitorProfileSource
  matchState: MonitorProfileMatchState
}

export interface MonitorProfileWizardInfo {
  activeDisplayId: string
  displays: MonitorDisplaySummary[]
  displayName: string
  activeTransport: MonitorTransport
  availableTransports: MonitorTransport[]
  detectedUsbHid?: { vendorId: number; productId: number }
  selectedProfileId: string | null
  manualProfileId: string | null
  profiles: MonitorProfileSummary[]
}

export interface UsbDevice {
  path: string
  name: string
  verified: boolean
  vendorId?: string
  productId?: string
  serialNumber?: string
  manufacturer?: string
}

export interface FirmwareImage {
  path: string
  name: string
  version: string
  chip: "ESP32-S3"
  size: number
  sha256: string
}

export interface LanDevice {
  id: string
  name: string
  address: string
  firmware: string
  paired: boolean
  wallpaperHash?: string
}

export type WallpaperKind = "image" | "video"
export type WallpaperIdleMinutes = 0 | 1 | 5 | 10 | 30

export interface WallpaperSettings {
  idleMinutes: WallpaperIdleMinutes
}

export interface WallpaperInfo {
  name: string
  kind: WallpaperKind
  size: number
  sha256: string
  frameCount: number
  durationMs: number
  updatedAt: string
}

export interface WallpaperUpload {
  name: string
  kind: WallpaperKind
  data: Uint8Array
}

export type MusicSource = "netease" | "qqmusic" | "other"
export type MusicPlaybackStatus = "playing" | "paused" | "stopped" | "unknown"
export type MusicPositionSource = "system" | "accessibility" | "estimated" | "manual" | "unavailable"
export type MusicRepeatMode = "none" | "track" | "list" | "unknown"
export type LyricsProvider = "netease" | "qqmusic" | "lrclib"

export interface MusicControls {
  play: boolean
  pause: boolean
  previous: boolean
  next: boolean
  seek: boolean
  shuffle: boolean
  repeat: boolean
}

export type MusicControlRequest =
  | { action: "play" | "pause" | "previous" | "next" | "cycle-repeat" | "toggle-shuffle" | "cycle-play-mode" }
  | { action: "seek"; positionMs: number }
  | { action: "set-shuffle"; enabled: boolean }
  | { action: "set-repeat"; repeatMode: Exclude<MusicRepeatMode, "unknown"> }

export interface MusicTrack {
  title: string
  artist: string
  album: string
  trackId: string
  artworkUrl: string
  sourceAppId: string
  source: MusicSource
  status: MusicPlaybackStatus
  positionMs: number
  durationMs: number
  playbackRate: number
  sampledAt: number
  positionSource: MusicPositionSource
  shuffleActive: boolean | null
  repeatMode: MusicRepeatMode
  controls: MusicControls
  detectedBy: "smtc" | "window" | "mpris" | "mediaremote" | "app-script"
}

export interface LyricLine {
  timeMs: number
  text: string
}

export interface MusicSnapshot {
  available: boolean
  track: MusicTrack | null
  provider: LyricsProvider | null
  lines: LyricLine[]
  plainText: string
  matchedTitle?: string
  matchedArtist?: string
  message: string
  syncReady: boolean
}

export type DiagnosticLevel = "info" | "warn" | "error"

export interface DiagnosticRecord {
  timestamp: string
  level: DiagnosticLevel
  event: string
  message: string
  control?: string
  source?: string
  transport?: string
  profile?: string
  durationMs?: number
  routeDurationMs?: number
  verification?: string
  reusedPreview?: boolean
  error?: string
}

export interface DiagnosticsControlMetrics {
  requests: number
  successes: number
  failures: number
  successRate: number | null
  averageDurationMs: number | null
  p95DurationMs: number | null
  averageRouteDurationMs: number | null
  reusedPreviews: number
  routeFailures: number
  readbackMismatches: number
}

export interface DiagnosticsSummary {
  generatedAt: string
  recordCount: number
  control: DiagnosticsControlMetrics
}

export interface DiagnosticsSystem {
  appVersion: string
  platform: string
  electronVersion: string
}

export interface DiagnosticsReport {
  summary: DiagnosticsSummary
  records: DiagnosticRecord[]
  connection: MonitorConnectionInfo
  status: MonitorStatus
  lanDevices: LanDevice[]
  system: DiagnosticsSystem
  logPath: string
}

export interface DesktopApi {
  music: {
    snapshot(): Promise<MusicSnapshot>
    calibrate(positionMs: number): Promise<MusicSnapshot>
    control(request: MusicControlRequest): Promise<MusicSnapshot>
  }
  monitor: {
    status(): Promise<MonitorStatus>
    statusSnapshot(): Promise<MonitorStatus>
    relayStatus(): Promise<MonitorStatus>
    control(request: ControlRequest): Promise<MonitorStatus>
    relayControl(request: ControlRequest, sourceNonce: string, sourceCommandId: string): Promise<ControlRequest["value"]>
    connection(): Promise<MonitorConnectionInfo>
    importProfile(): Promise<MonitorConnectionInfo | null>
    listDisplays(): Promise<MonitorDisplayList>
    selectDisplay(displayId: string): Promise<MonitorConnectionInfo>
    profileWizard(force?: boolean): Promise<MonitorProfileWizardInfo>
    activateProfile(profileId: string): Promise<MonitorConnectionInfo>
    resetProfile(): Promise<MonitorConnectionInfo>
  }
  device: {
    listUsb(): Promise<UsbDevice[]>
    discoverLan(): Promise<LanDevice[]>
    listLan(): Promise<LanDevice[]>
    verifyUsb(path: string): Promise<{ chip: string; mac: string }>
    scanWifi(path: string): Promise<Array<{ ssid: string; rssi: number; secure: boolean }>>
    configureWifi(path: string, ssid: string, password: string): Promise<void>
    prepareBle(path: string): Promise<void>
    selectFirmware(): Promise<FirmwareImage | null>
    flash(path: string, firmwarePath: string, expectedSha256: string): Promise<void>
  }
  wallpaper: {
    info(): Promise<WallpaperInfo | null>
    settings(): Promise<WallpaperSettings>
    setIdleMinutes(minutes: WallpaperIdleMinutes): Promise<WallpaperSettings>
    upload(input: WallpaperUpload): Promise<WallpaperInfo>
    remove(): Promise<void>
  }
  security: {
    sign(message: string): Promise<string>
  }
  diagnostics: {
    report(): Promise<DiagnosticsReport>
  }
}

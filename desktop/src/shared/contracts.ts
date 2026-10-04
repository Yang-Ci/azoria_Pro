import type { UsageApi } from "./usage"

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
  touchSleepEnabled?: boolean
  touchSleepStartMinutes?: number
  touchSleepEndMinutes?: number
  touchSleepActive?: boolean
  touchRotationDegrees?: TouchRotation
  musicAvailable?: boolean
  musicPlaying?: boolean
  musicCanSeek?: boolean
  musicTitle?: string
  musicArtist?: string
  musicMode?: string
  musicSource?: MusicSource
  musicPositionMs?: number
  musicDurationMs?: number
  musicLyricPrevious3?: string
  musicLyricPrevious2?: string
  musicLyricPrevious?: string
  musicLyricCurrent?: string
  musicLyricNext?: string
  musicLyricNext2?: string
  musicLyricNext3?: string
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

export interface BrightnessBaseline { displayId: string; baseline: number }
export interface BrightnessLinkSettings { enabled: boolean; displays: BrightnessBaseline[] }
export interface BrightnessScene { id: string; name: string; displays: BrightnessBaseline[] }
export interface BrightnessLinkSnapshot extends BrightnessLinkSettings {
  offset: number
  minimumOffset: number
  maximumOffset: number
  scenes: BrightnessScene[]
  activeSceneId: string | null
  results: Array<{ displayId: string; brightness: number | null; error: string | null }>
}

export interface ComputerSample {
  sampledAt: number
  cpuPercent: number | null
  memoryPercent: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  networkRxBps: number | null
  networkTxBps: number | null
}
export interface ComputerSnapshot extends ComputerSample {
  available: boolean
  networkAvailable: boolean
  history: ComputerSample[]
}
export interface DesktopPreferences {
  closeToTray: boolean
  startAtLogin: boolean
  hotkeysEnabled: boolean
  brightnessUp: string
  brightnessDown: string
  nextScene: string
}
export interface DesktopPreferencesSnapshot extends DesktopPreferences {
  startupAvailable: boolean
  trayAvailable: boolean
  shortcutError: string | null
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
  wallpaperStorage?: "tf" | "flash" | "unavailable"
  wallpaperLimit?: number
}

export type WallpaperKind = "image" | "video"
export type WallpaperIdleMinutes = 0 | 1 | 5 | 10 | 30
export type TouchRotation = 0 | 90 | 180 | 270

export interface WallpaperSettings {
  idleMinutes: WallpaperIdleMinutes
}

export interface WallpaperSchedule {
  id: string
  time: string
  wallpaperId: string
  enabled: boolean
}

export interface WallpaperPlaybackSettings {
  enabled: boolean
  intervalMinutes: number
  order: "sequential" | "random"
  playlist: string[]
  schedules: WallpaperSchedule[]
}

export interface WallpaperLibraryItem extends WallpaperInfo {
  id: string
}

export interface WallpaperLibrarySnapshot {
  items: WallpaperLibraryItem[]
  activeId: string | null
  playback: WallpaperPlaybackSettings
  nextSwitchAt: string | null
  error: string | null
}

export interface TouchSleepSettings {
  enabled: boolean
  startMinutes: number
  endMinutes: number
  active: boolean
}

export interface TouchSleepUpdate {
  enabled: boolean
  startMinutes: number
  endMinutes: number
}

export interface TouchRotationSettings {
  degrees: TouchRotation
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
  computer: { snapshot(): Promise<ComputerSnapshot> }
  desktop: {
    preferences(): Promise<DesktopPreferencesSnapshot>
    updatePreferences(input: DesktopPreferences): Promise<DesktopPreferencesSnapshot>
    onMessage(callback: (message: string) => void): () => void
  }
  brightnessLink: {
    snapshot(): Promise<BrightnessLinkSnapshot>
    save(input: BrightnessLinkSettings): Promise<BrightnessLinkSnapshot>
    capture(displayIds: string[]): Promise<BrightnessBaseline[]>
    setOffset(offset: number): Promise<BrightnessLinkSnapshot>
    saveScene(name: string): Promise<BrightnessLinkSnapshot>
    applyScene(id: string): Promise<BrightnessLinkSnapshot>
    deleteScene(id: string): Promise<BrightnessLinkSnapshot>
  }
  usage: UsageApi
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
    library(): Promise<WallpaperLibrarySnapshot>
    preview(id: string): Promise<string>
    activate(id: string): Promise<WallpaperLibrarySnapshot>
    deleteItem(id: string): Promise<WallpaperLibrarySnapshot>
    setPlayback(settings: WallpaperPlaybackSettings): Promise<WallpaperLibrarySnapshot>
    next(): Promise<WallpaperLibrarySnapshot>
    setIdleMinutes(minutes: WallpaperIdleMinutes): Promise<WallpaperSettings>
    upload(input: WallpaperUpload): Promise<WallpaperInfo>
    remove(): Promise<void>
  }
  touchSleep: {
    settings(): Promise<TouchSleepSettings>
    update(input: TouchSleepUpdate): Promise<TouchSleepSettings>
  }
  touchRotation: {
    settings(): Promise<TouchRotationSettings>
    rotateClockwise(): Promise<TouchRotationSettings>
  }
  security: {
    sign(message: string): Promise<string>
  }
  diagnostics: {
    report(): Promise<DiagnosticsReport>
  }
}

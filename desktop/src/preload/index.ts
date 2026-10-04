import { contextBridge, ipcRenderer } from "electron"
import type { ControlRequest, DesktopApi, MusicControlRequest } from "../shared/contracts"
import type { ApiProviderInput } from "../shared/usage"

const api: DesktopApi = {
  usage: {
    touch: (index?: number) => ipcRenderer.invoke("usage:touch", index),
    codex: () => ipcRenderer.invoke("usage:codex"),
    providers: () => ipcRenderer.invoke("usage:providers"),
    saveProvider: (input: ApiProviderInput) => ipcRenderer.invoke("usage:save-provider", input),
    deleteProvider: (id: string) => ipcRenderer.invoke("usage:delete-provider", id),
    refreshProvider: (id: string) => ipcRenderer.invoke("usage:refresh-provider", id),
    testProvider: (input: ApiProviderInput) => ipcRenderer.invoke("usage:test-provider", input),
  },
  music: {
    snapshot: () => ipcRenderer.invoke("music:snapshot"),
    calibrate: (positionMs: number) => ipcRenderer.invoke("music:calibrate", positionMs),
    control: (request: MusicControlRequest) => ipcRenderer.invoke("music:control", request),
  },
  monitor: {
    status: () => ipcRenderer.invoke("monitor:status"),
    statusSnapshot: () => ipcRenderer.invoke("monitor:status-snapshot"),
    relayStatus: () => ipcRenderer.invoke("monitor:relay-status"),
    control: (request: ControlRequest) => ipcRenderer.invoke("monitor:control", request),
    relayControl: (request: ControlRequest, sourceNonce: string, sourceCommandId: string) =>
      ipcRenderer.invoke("monitor:relay-control", request, sourceNonce, sourceCommandId),
    connection: () => ipcRenderer.invoke("monitor:connection"),
    importProfile: () => ipcRenderer.invoke("monitor:import-profile"),
    listDisplays: () => ipcRenderer.invoke("monitor:list-displays"),
    selectDisplay: (displayId: string) => ipcRenderer.invoke("monitor:select-display", displayId),
    profileWizard: (force?: boolean) => ipcRenderer.invoke("monitor:profile-wizard", force),
    activateProfile: (profileId: string) => ipcRenderer.invoke("monitor:activate-profile", profileId),
    resetProfile: () => ipcRenderer.invoke("monitor:reset-profile"),
  },
  device: {
    listUsb: () => ipcRenderer.invoke("device:list-usb"),
    discoverLan: () => ipcRenderer.invoke("device:discover-lan"),
    listLan: () => ipcRenderer.invoke("device:list-lan"),
    verifyUsb: (path: string) => ipcRenderer.invoke("device:verify-usb", path),
    scanWifi: (path: string) => ipcRenderer.invoke("device:scan-wifi", path),
    configureWifi: (path: string, ssid: string, password: string) =>
      ipcRenderer.invoke("device:configure-wifi", { path, ssid, password }),
    prepareBle: (path: string) => ipcRenderer.invoke("device:prepare-ble", path),
    selectFirmware: () => ipcRenderer.invoke("device:select-firmware"),
    flash: (path: string, firmwarePath: string, expectedSha256: string) =>
      ipcRenderer.invoke("device:flash", { path, firmwarePath, expectedSha256 }),
  },
  wallpaper: {
    info: () => ipcRenderer.invoke("wallpaper:info"),
    settings: () => ipcRenderer.invoke("wallpaper:settings"),
    library: () => ipcRenderer.invoke("wallpaper:library"),
    preview: (id) => ipcRenderer.invoke("wallpaper:preview", id),
    activate: (id) => ipcRenderer.invoke("wallpaper:activate", id),
    deleteItem: (id) => ipcRenderer.invoke("wallpaper:delete-item", id),
    setPlayback: (settings) => ipcRenderer.invoke("wallpaper:set-playback", settings),
    next: () => ipcRenderer.invoke("wallpaper:next"),
    setIdleMinutes: (minutes) => ipcRenderer.invoke("wallpaper:set-idle-minutes", minutes),
    upload: (input) => ipcRenderer.invoke("wallpaper:upload", input),
    remove: () => ipcRenderer.invoke("wallpaper:remove"),
  },
  touchSleep: {
    settings: () => ipcRenderer.invoke("touch-sleep:settings"),
    update: (input) => ipcRenderer.invoke("touch-sleep:update", input),
  },
  security: {
    sign: (message: string) => ipcRenderer.invoke("security:sign", message),
  },
  diagnostics: {
    report: () => ipcRenderer.invoke("diagnostics:report"),
  },
}

contextBridge.exposeInMainWorld("azoria", api)

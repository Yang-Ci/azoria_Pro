import { createHmac } from "node:crypto"
import path from "node:path"
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, Tray, type OpenDialogOptions } from "electron"
import type { ControlRequest } from "../shared/contracts"
import type { ApiProviderInput } from "../shared/usage"
import { loadConfig, saveDisplayPreference } from "./config"
import { DiagnosticsController } from "./diagnostics"
import { TouchManager } from "./touch"
import { LanController } from "./lan"
import { LocalLogger } from "./logger"
import { MonitorController } from "./monitor"
import { WallpaperManager } from "./wallpaper"
import { MusicManager } from "./music"
import { TouchSleepManager } from "./touch-sleep"
import { CodexQuotaService } from "./codex-quota"
import { UsageProviderStore } from "./usage-provider-store"
import { ApiUsageService } from "./api-usage"
import { TouchUsageService } from "./touch-usage"
import { BrightnessLinkManager } from "./brightness-link"
import { ComputerStatsService } from "./computer"
import { DesktopPreferencesManager } from "./desktop-preferences"

const isDevelopment = !app.isPackaged
let quitting = false
let tray: Tray | undefined
let preferences: DesktopPreferencesManager | undefined
let windowReady = false

function showWindow(): void {
  if (!windowReady) return
  const window = BrowserWindow.getAllWindows()[0] || createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

app.setName("YangCi")
if (process.platform === "linux") app.setDesktopName("azoria-desktop.desktop")
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on("second-instance", () => {
  showWindow()
})
app.on("before-quit", () => { quitting = true; preferences?.dispose(); tray?.destroy(); tray = undefined })
for (const option of [
  "disable-component-update",
  "disable-client-side-phishing-detection",
  "disable-sync",
  "metrics-recording-only",
  "no-first-run",
]) app.commandLine.appendSwitch(option)

function createWindow(): BrowserWindow {
  let bluetoothCallback: ((deviceId: string) => void) | undefined
  let bluetoothTimeout: ReturnType<typeof setTimeout> | undefined

  const finishBluetoothSelection = (deviceId: string) => {
    if (bluetoothTimeout) clearTimeout(bluetoothTimeout)
    bluetoothTimeout = undefined
    const callback = bluetoothCallback
    bluetoothCallback = undefined
    callback?.(deviceId)
  }

  const window = new BrowserWindow({
    show: !(process.argv.includes("--hidden") && tray),
    icon: path.join(app.getAppPath(), "desktop/assets/icon.png"),
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: "#000000",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Touch BLE requests are polled by the renderer even while in the tray.
      backgroundThrottling: false,
    },
  })
  window.on("close", (event) => {
    if (!quitting && tray && preferences?.snapshot().closeToTray) { event.preventDefault(); window.hide() }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  if (isDevelopment) {
    window.webContents.on("console-message", (details) => {
      if (details.message.startsWith("AZORIA_BLE_")) console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:") && !url.startsWith("http://localhost:")) event.preventDefault()
  })
  window.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault()
    bluetoothCallback = callback
    if (isDevelopment) {
      const names = devices.map((candidate) => candidate.deviceName || "(unnamed)").join(",")
      console.log(`[bluetooth] candidates=${names || "none"}`)
    }
    const device = devices.find((candidate) => candidate.deviceName.toLowerCase().includes("azoria"))
    if (device) {
      finishBluetoothSelection(device.deviceId)
      return
    }
    bluetoothTimeout ??= setTimeout(() => finishBluetoothSelection(""), 12_000)
  })
  window.on("closed", () => {
    if (bluetoothTimeout) clearTimeout(bluetoothTimeout)
    bluetoothTimeout = undefined
    bluetoothCallback = undefined
  })
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
  return window
}

if (hasInstanceLock) void app.whenReady().then(async () => {
  const config = await loadConfig(app.getPath("userData"))
  app.setAppLogsPath()
  const logger = new LocalLogger(app.getPath("logs"))
  await logger.initialize().catch(() => undefined)
  const monitor = new MonitorController(
    config.display,
    path.resolve(app.getAppPath(), "desktop/profiles"),
    path.join(app.getPath("userData"), "monitor-profiles"),
    isDevelopment
      ? path.resolve(app.getAppPath(), "sidecar/target/release", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar")
      : path.join(process.resourcesPath, "sidecar", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar"),
    logger,
  )
  await monitor.initialize()
  const initialConnection = monitor.connectionSnapshot()
  if (initialConnection.displayId !== config.display) {
    await saveDisplayPreference(app.getPath("userData"), initialConnection.displayId)
  }
  monitor.startBackgroundStatus()
  const sidecarBinary = isDevelopment
    ? path.resolve(app.getAppPath(), "sidecar/target/release", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar")
    : path.join(process.resourcesPath, "sidecar", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar")
  const brightnessLink = new BrightnessLinkManager(app.getPath("userData"), monitor)
  await brightnessLink.initialize()
  const computer = new ComputerStatsService(sidecarBinary)
  computer.start()
  app.once("before-quit", () => computer.stop())
  const wallpaper = new WallpaperManager(app.getPath("userData"))
  await wallpaper.initialize()
  wallpaper.start()
  app.once("before-quit", () => wallpaper.stop())
  const touchSleep = new TouchSleepManager(app.getPath("userData"))
  await touchSleep.initialize()
  const music = new MusicManager(
    isDevelopment
      ? path.resolve(app.getAppPath(), "sidecar/target/release", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar")
      : path.join(process.resourcesPath, "sidecar", process.platform === "win32" ? "azoria-ddc-sidecar.exe" : "azoria-ddc-sidecar"),
  )
  music.startPolling()
  const codexQuota = new CodexQuotaService(app.getPath("userData"))
  const usageProviders = new UsageProviderStore(app.getPath("userData"), {
    available: () => safeStorage.isEncryptionAvailable()
      && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  })
  const apiUsage = new ApiUsageService(usageProviders)
  const touchUsage = new TouchUsageService(codexQuota, usageProviders, apiUsage)
  touchUsage.start()
  app.once("before-quit", () => touchUsage.stop())
  const lan = new LanController(config.desktopId, monitor, wallpaper, music, touchSleep, touchUsage, computer, brightnessLink)
  await lan.start()
  const devices = new TouchManager(config.token)
  const diagnostics = new DiagnosticsController(logger, monitor, lan)

  const reportAction = async (operation: () => Promise<unknown>, success: string) => {
    let message = success
    try {
      await operation()
      const failures = brightnessLink.snapshot().results.filter(item => item.error)
      if (failures.length) message = `${success}；${failures.length} 块屏幕调整失败，请查看联动面板`
      refreshTray()
    } catch (error) {
      message = error instanceof Error ? error.message : "操作失败"
      logger.error("desktop.action_failed", { error: message })
    }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("desktop:message", message)
  }
  const startupAvailable = app.isPackaged && ["win32", "darwin"].includes(process.platform)
  const startupOptions = { path: process.execPath, args: ["--hidden"] }
  preferences = new DesktopPreferencesManager(app.getPath("userData"), {
    startupAvailable,
    getStartup: () => startupAvailable && app.getLoginItemSettings(startupOptions).openAtLogin,
    setStartup: (enabled) => app.setLoginItemSettings({ ...startupOptions, openAtLogin: enabled }),
    register: (key, action) => globalShortcut.register(key, () => {
      void reportAction(() => action === "nextScene" ? brightnessLink.nextScene() : brightnessLink.adjust(action === "brightnessUp" ? 5 : -5), action === "nextScene" ? "已切换亮度场景" : "亮度已调整")
    }),
    unregister: (key) => globalShortcut.unregister(key),
  })
  await preferences.initialize()
  function refreshTray(): void {
    if (!tray) return
    const state = brightnessLink.snapshot()
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开 YangCi", click: showWindow }, { type: "separator" },
      { label: "亮度提高 5 点", click: () => { void reportAction(() => brightnessLink.adjust(5), "亮度已提高") } },
      { label: "亮度降低 5 点", click: () => { void reportAction(() => brightnessLink.adjust(-5), "亮度已降低") } },
      { label: "亮度场景", enabled: state.scenes.length > 0, submenu: state.scenes.map(scene => ({ label: scene.name, type: "radio" as const, checked: state.activeSceneId === scene.id, click: () => { void reportAction(() => brightnessLink.applyScene(scene.id), `已切换到 ${scene.name}`) } })) },
      { type: "separator" }, { label: "退出 YangCi", click: () => app.quit() },
    ]))
  }
  try {
    const image = nativeImage.createFromPath(path.join(app.getAppPath(), "desktop/assets/icon.png"))
    if (!image.isEmpty()) {
      tray = new Tray(image.resize({ width: process.platform === "win32" ? 32 : 18, height: process.platform === "win32" ? 32 : 18 }))
      tray.setToolTip("YangCi · 显示器与 Touch 控制")
      tray.on("click", showWindow)
      preferences.setTrayAvailable(true)
      refreshTray()
    }
  } catch (error) { logger.error("desktop.tray_failed", { error: error instanceof Error ? error.message : "托盘创建失败" }) }
  const changedLink = async (operation: () => Promise<unknown>) => { const value = await operation(); refreshTray(); return value }
  ipcMain.handle("computer:snapshot", () => computer.snapshot())
  ipcMain.handle("desktop:preferences", () => preferences!.snapshot())
  ipcMain.handle("desktop:update-preferences", (_event, input) => preferences!.update(input))
  ipcMain.handle("brightness-link:snapshot", () => brightnessLink.snapshot())
  ipcMain.handle("brightness-link:save", (_event, input) => changedLink(() => brightnessLink.save(input)))
  ipcMain.handle("brightness-link:capture", (_event, ids) => brightnessLink.capture(ids))
  ipcMain.handle("brightness-link:set-offset", (_event, offset) => changedLink(() => brightnessLink.setOffset(offset)))
  ipcMain.handle("brightness-link:save-scene", (_event, name) => changedLink(() => brightnessLink.saveScene(name)))
  ipcMain.handle("brightness-link:apply-scene", (_event, id) => changedLink(() => brightnessLink.applyScene(id)))
  ipcMain.handle("brightness-link:delete-scene", (_event, id) => changedLink(() => brightnessLink.deleteScene(id)))

  ipcMain.handle("usage:touch", (_event, index?: number) => touchUsage.snapshot(Number.isInteger(index) ? index : 0))
  ipcMain.handle("usage:codex", () => codexQuota.collect())
  ipcMain.handle("usage:providers", () => usageProviders.list())
  ipcMain.handle("usage:save-provider", (_event, input: ApiProviderInput) => usageProviders.save(input))
  ipcMain.handle("usage:delete-provider", (_event, id: string) => usageProviders.delete(id))
  ipcMain.handle("usage:refresh-provider", (_event, id: string) => apiUsage.refresh(id))
  ipcMain.handle("usage:test-provider", (_event, input: ApiProviderInput) => apiUsage.test(input))

  ipcMain.handle("monitor:status", () => monitor.status())
  ipcMain.handle("monitor:status-snapshot", () => monitor.statusSnapshot())
  ipcMain.handle("monitor:relay-status", () => lan.relayStatus())
  ipcMain.handle("monitor:control", (_event, request: ControlRequest) => brightnessLink.control(request, "desktop-ui"))
  ipcMain.handle("monitor:relay-control", (_event, request: ControlRequest, sourceNonce: string, sourceCommandId: string) =>
    lan.relayControl(request, sourceNonce, sourceCommandId))
  ipcMain.handle("monitor:connection", () => monitor.connection())
  ipcMain.handle("monitor:list-displays", () => monitor.listDisplays())
  ipcMain.handle("monitor:select-display", async (_event, displayId: string) => {
    const connection = await monitor.selectDisplay(displayId)
    await saveDisplayPreference(app.getPath("userData"), connection.displayId)
    return connection
  })
  ipcMain.handle("monitor:profile-wizard", (_event, force: boolean | undefined) => monitor.profileWizard(force === true))
  ipcMain.handle("monitor:activate-profile", (_event, profileId: string) => monitor.activateProfile(profileId))
  ipcMain.handle("monitor:reset-profile", () => monitor.resetProfile())
  ipcMain.handle("monitor:import-profile", async (event) => {
    const options: OpenDialogOptions = {
      title: "加载显示器配置表",
      properties: ["openFile"],
      filters: [{ name: "显示器配置表", extensions: ["json"] }],
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return monitor.importProfile(result.filePaths[0])
  })
  ipcMain.handle("device:list-usb", () => devices.listUsb())
  ipcMain.handle("device:discover-lan", () => lan.discover())
  ipcMain.handle("device:list-lan", () => lan.devices())
  ipcMain.handle("device:verify-usb", (_event, devicePath: string) => devices.verifyUsb(devicePath))
  ipcMain.handle("device:scan-wifi", (_event, devicePath: string) => devices.scanWifi(devicePath))
  ipcMain.handle("device:configure-wifi", (_event, input: { path: string; ssid: string; password: string }) =>
    devices.configureWifi(input.path, input.ssid, input.password))
  ipcMain.handle("device:prepare-ble", (_event, devicePath: string) => devices.prepareBle(devicePath))
  ipcMain.handle("device:select-firmware", async (event) => {
    const options: OpenDialogOptions = {
      title: "选择 AZORIA Touch 固件",
      properties: ["openFile"],
      filters: [{ name: "AZORIA Touch 固件", extensions: ["bin"] }],
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return devices.inspectFirmware(result.filePaths[0])
  })
  ipcMain.handle("device:flash", (_event, input: { path: string; firmwarePath: string; expectedSha256: string }) =>
    devices.flash(input.path, input.firmwarePath, input.expectedSha256))
  ipcMain.handle("wallpaper:info", () => wallpaper.info())
  ipcMain.handle("wallpaper:settings", () => wallpaper.settings())
  ipcMain.handle("wallpaper:library", () => wallpaper.library())
  ipcMain.handle("wallpaper:preview", (_event, id: string) => wallpaper.preview(id))
  ipcMain.handle("wallpaper:activate", (_event, id: string) => wallpaper.activate(id))
  ipcMain.handle("wallpaper:delete-item", (_event, id: string) => wallpaper.deleteItem(id))
  ipcMain.handle("wallpaper:set-playback", (_event, input) => wallpaper.setPlayback(input))
  ipcMain.handle("wallpaper:next", () => wallpaper.next())
  ipcMain.handle("wallpaper:set-idle-minutes", (_event, minutes: number) => wallpaper.setIdleMinutes(minutes))
  ipcMain.handle("wallpaper:upload", (_event, input) => wallpaper.upload(input))
  ipcMain.handle("wallpaper:remove", () => wallpaper.remove())
  ipcMain.handle("touch-sleep:settings", () => touchSleep.settings())
  ipcMain.handle("touch-sleep:update", (_event, input) => touchSleep.update(input))
  ipcMain.handle("security:sign", (_event, message: string) => {
    if (typeof message !== "string" || message.length > 512) throw new Error("签名消息无效")
    return createHmac("sha256", config.token).update(message).digest("hex").slice(0, 16)
  })
  ipcMain.handle("diagnostics:report", () => diagnostics.report())
  ipcMain.handle("music:snapshot", () => music.snapshot())
  ipcMain.handle("music:calibrate", (_event, positionMs: number) => music.calibrate(positionMs))
  ipcMain.handle("music:control", (_event, request) => music.control(request))

  windowReady = true
  createWindow()
  app.on("activate", showWindow)
})

app.on("before-quit", () => LanController.stopAll())
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })

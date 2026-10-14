import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { PowerData } from "../shared/contracts"

const run = promisify(execFile)
const linuxPowerData = String.raw`
import json
from gi.repository import Gio
bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
def call(service, path, interface, method, args=None):
    return bus.call_sync(service, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 3000, None).unpack()
def properties(service, path, interface):
    from gi.repository import GLib
    return call(service, path, "org.freedesktop.DBus.Properties", "GetAll", GLib.Variant("(s)", (interface,)))[0]
from gi.repository import GLib
path = call("org.freedesktop.UPower", "/org/freedesktop/UPower", "org.freedesktop.UPower", "GetDisplayDevice")[0]
display = properties("org.freedesktop.UPower", path, "org.freedesktop.UPower.Device")
states = {1: "charging", 2: "discharging", 4: "full", 5: "charging", 6: "discharging"}
present = bool(display.get("IsPresent", False))
devices = []
for path in call("org.freedesktop.UPower", "/org/freedesktop/UPower", "org.freedesktop.UPower", "EnumerateDevices")[0]:
    data = properties("org.freedesktop.UPower", path, "org.freedesktop.UPower.Device")
    native = data.get("NativePath", "")
    if not native.startswith("/org/bluez/"): continue
    device = {}
    try:
        device = properties("org.bluez", native, "org.bluez.Device1")
        if not device.get("Connected", False): continue
        battery = properties("org.bluez", native, "org.bluez.Battery1")
        level = battery.get("Percentage")
    except Exception:
        level = data.get("Percentage") if data.get("Percentage", 0) > 0 else None
    devices.append({"name": data.get("Model", "").strip() or device.get("Alias", "Bluetooth device"), "level": level})
print(json.dumps({"batteryLevel": display.get("Percentage") if present else None,
 "batteryStatus": states.get(display.get("State"), "unknown") if present else "no-battery", "devices": devices}))
`

export const unavailablePowerData: PowerData = {
  available: false, batteryLevel: null, batteryStatus: "unknown", devices: [], mode: "unknown", sampledAt: null, error: null,
}

export class PowerDataService {
  private state: PowerData = { ...unavailablePowerData }
  private pending?: Promise<PowerData>
  snapshot(): PowerData { return structuredClone(this.state) }
  collect(): Promise<PowerData> {
    if (this.pending) return this.pending
    if (this.state.sampledAt && Date.now() - this.state.sampledAt < 3000) return Promise.resolve(this.snapshot())
    this.pending = this.read().finally(() => { this.pending = undefined })
    return this.pending
  }
  private async read(): Promise<PowerData> {
    if (process.platform !== "linux") return { ...unavailablePowerData, error: "当前系统尚未提供电源数据采集" }
    const [battery, profile] = await Promise.allSettled([
      run("/usr/bin/python3", ["-c", linuxPowerData], { timeout: 10000, maxBuffer: 65536 }),
      run("powerprofilesctl", ["get"], { timeout: 3000 }),
    ])
    const mode = profile.status === "fulfilled" ? profile.value.stdout.trim() : "unknown"
    try {
      if (battery.status !== "fulfilled") throw new Error("系统电池服务不可用")
      const data = JSON.parse(battery.value.stdout) as Partial<PowerData>
      const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null
      this.state = { available: true, batteryLevel: percent(data.batteryLevel),
        batteryStatus: ["charging", "discharging", "full", "no-battery", "unknown"].includes(String(data.batteryStatus)) ? data.batteryStatus! : "unknown",
        devices: Array.isArray(data.devices) ? data.devices.flatMap(item => typeof item.name === "string" ? [{ name: item.name.slice(0, 120), level: percent(item.level) }] : []) : [],
        mode: mode === "performance" || mode === "balanced" || mode === "power-saver" ? mode : "unknown",
        sampledAt: Date.now(), error: null }
    } catch {
      this.state = { ...unavailablePowerData, sampledAt: Date.now(), error: "电源数据读取失败，正在重试" }
    }
    return this.snapshot()
  }
}

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
export interface DisplayLayout {
  monitors: Array<{ connector: string; builtin: boolean; modes: Array<{ id: string; preferred: boolean }> }>
  groups: Array<{ x: number; y: number; scale: number; transform: number; primary: boolean; monitors: Array<{ connector: string; mode: string }> }>
  layoutMode: number
}
export interface DisplayPowerBackend {
  capture(): Promise<DisplayLayout>
  isolate(layout: DisplayLayout): Promise<void>
  restore(layout: DisplayLayout): Promise<void>
}

const mutterScript = String.raw`
import json, sys
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
service, path, interface = "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig", "org.gnome.Mutter.DisplayConfig"
def call(method, args=None):
    return bus.call_sync(service, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 10000, None).unpack()
serial, monitors, groups, props = call("GetCurrentState")
current = {}
for spec, modes, attributes in monitors:
    current[spec[0]] = {"connector": spec[0], "builtin": bool(attributes.get("is-builtin", False)),
        "modes": [{"id": mode[0], "preferred": bool(mode[-1].get("is-preferred", False)), "current": bool(mode[-1].get("is-current", False))} for mode in modes]}
saved_groups = []
for x,y,scale,transform,primary,specs,attributes in groups:
    selected = []
    for spec in specs:
        mode = next((mode["id"] for mode in current[spec[0]]["modes"] if mode["current"]), None)
        if mode: selected.append({"connector": spec[0], "mode": mode})
    if selected: saved_groups.append({"x":x,"y":y,"scale":scale,"transform":transform,"primary":primary,"monitors":selected})
action = sys.argv[1]
if action == "capture":
    print(json.dumps({"monitors":list(current.values()), "groups":saved_groups, "layoutMode":props.get("layout-mode",1)}))
    sys.exit(0)
layout = json.loads(sys.argv[2])
if action == "off":
    internal = [monitor for monitor in current.values() if monitor["builtin"]]
    if not internal: raise RuntimeError("No built-in display is available; refusing to turn off all screens")
    monitor = internal[0]
    group = next((g for g in layout["groups"] if any(m["connector"]==monitor["connector"] for m in g["monitors"])), None)
    mode = next((m["mode"] for m in group["monitors"] if m["connector"]==monitor["connector"]), None) if group else None
    mode = mode or next((m["id"] for m in monitor["modes"] if m["preferred"]), monitor["modes"][0]["id"])
    selected = [(0,0,group["scale"] if group else 1.0,group["transform"] if group else 0,True,[(monitor["connector"],mode,{})])]
else:
    selected = []
    for group in layout["groups"]:
        configured = []
        for monitor in group["monitors"]:
            available = current.get(monitor["connector"])
            if not available: continue
            modes = available["modes"]
            mode = next((m["id"] for m in modes if m["id"]==monitor["mode"]), None)
            mode = mode or next((m["id"] for m in modes if m["preferred"]), modes[0]["id"])
            configured.append((monitor["connector"], mode, {}))
        if configured: selected.append((group["x"],group["y"],group["scale"],group["transform"],group["primary"],configured))
    if not selected: raise RuntimeError("No saved display is connected")
    if not any(g[4] for g in selected):
        g=selected[0]; selected[0]=(*g[:4],True,g[5])
    min_x,min_y=min(g[0] for g in selected),min(g[1] for g in selected)
    selected=[(g[0]-min_x,g[1]-min_y,*g[2:]) for g in selected]
options = {}
if layout["layoutMode"] != props.get("layout-mode", 1):
    if not props.get("supports-changing-layout-mode", False): raise RuntimeError("Desktop cannot change the stored layout mode")
    options["layout-mode"] = GLib.Variant("u", layout["layoutMode"])
call("ApplyMonitorsConfig", GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (serial,1,selected,options)))
print(json.dumps({"ok":True}))
`

export class GnomeDisplayPowerBackend implements DisplayPowerBackend {
  private async command(action: string, layout?: DisplayLayout): Promise<string> {
    if (process.platform !== "linux") throw new Error("外接屏一键息屏目前需要 Ubuntu / GNOME 桌面")
    try {
      const result = await run("/usr/bin/python3", ["-c", mutterScript, action, ...(layout ? [JSON.stringify(layout)] : [])], { timeout: 15000, maxBuffer: 262144 })
      return result.stdout
    } catch (error) {
      const details = (error as { stderr?: string }).stderr?.trim().split("\n").at(-1)?.replace(/^.*(?:InvalidArgs:|RuntimeError:)\s*/, "")
      throw new Error(`系统显示服务${action === "off" ? "息屏" : action === "on" ? "恢复" : "读取"}失败${details ? `：${details.slice(0, 180)}` : ""}`)
    }
  }
  async capture(): Promise<DisplayLayout> { return JSON.parse(await this.command("capture")) as DisplayLayout }
  async isolate(layout: DisplayLayout): Promise<void> { await this.command("off", layout) }
  async restore(layout: DisplayLayout): Promise<void> {
    const expected = layout.groups.flatMap(group => group.monitors.map(monitor => monitor.connector))
    // Power-on can take a moment to republish EDID and modes to the compositor.
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.capture()
      if (expected.every(connector => current.monitors.some(monitor => monitor.connector === connector))) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    await this.command("on", layout)
  }
}

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
export async function systemIdleSeconds(fallback: () => number): Promise<number | null> {
  try {
    if (process.platform === "linux") {
      const { stdout } = await run("/usr/bin/gdbus", ["call", "--session", "--dest", "org.gnome.Mutter.IdleMonitor",
        "--object-path", "/org/gnome/Mutter/IdleMonitor/Core", "--method", "org.gnome.Mutter.IdleMonitor.GetIdletime"], { timeout: 2000, maxBuffer: 1024 })
      const match = /^\(uint64 (\d+),\)\s*$/.exec(stdout)
      if (match) return Number(match[1]) / 1000
      // An unreadable idle source must not be mistaken for inactivity.
      return null
    }
    const seconds = fallback()
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  } catch { return null }
}

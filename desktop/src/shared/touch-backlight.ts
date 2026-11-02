import type { MonitorStatus, TouchBacklightState } from "./contracts"

// Keep the existing firmware protocol. Its local clock evaluates this window;
// Desktop updates the enable flag whenever the linked state changes.
export function touchBacklightWire(state: TouchBacklightState | undefined, now = new Date()): Partial<MonitorStatus> {
  if (!state) return {}
  const minutes = now.getHours() * 60 + now.getMinutes()
  return { touchSleepEnabled: !state.awake, touchSleepActive: !state.awake,
    touchSleepStartMinutes: minutes,
    touchSleepEndMinutes: (minutes + 1439) % 1440 }
}

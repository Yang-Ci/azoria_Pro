import type { PowerData } from "./contracts"

export const maxTouchBluetoothDevices = 255

// Both transports use the same bounded UTF-8 name and flat fields for Touch.
export function touchBluetoothStatus(data: PowerData, requestedIndex = 0) {
  const devices = data.available ? data.devices.slice(0, maxTouchBluetoothDevices) : []
  const index = Math.max(0, Math.min(requestedIndex, devices.length - 1))
  const device = devices[index]
  let name = ""
  for (const character of (device?.name || "蓝牙设备").replace(/[\\"|\r\n\t]/g, " ").trim()) {
    if (new TextEncoder().encode(name + character).byteLength > 60) break
    name += character
  }
  return {
    bluetoothAvailable: data.available,
    bluetoothCount: devices.length,
    bluetoothIndex: index,
    bluetoothName: device ? name || "蓝牙设备" : "",
    bluetoothLevel: device?.level ?? -1,
  }
}

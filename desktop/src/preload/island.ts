import { contextBridge, ipcRenderer } from "electron"
import type { IslandApi } from "../shared/contracts"

const api: IslandApi = {
  snapshot: () => ipcRenderer.invoke("island:snapshot"),
  expand: (expanded) => ipcRenderer.invoke("island:expand", expanded),
  music: (action) => ipcRenderer.invoke("island:music", action),
  monitor: (control, value) => ipcRenderer.invoke("island:monitor", control, value),
  openMain: () => ipcRenderer.invoke("island:open-main"),
}
contextBridge.exposeInMainWorld("island", api)

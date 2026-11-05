/// <reference types="vite/client" />

import type { DesktopApi, IslandApi } from "../../shared/contracts"

declare global {
  interface Window {
    azoria: DesktopApi
    island: IslandApi
  }
}

export {}

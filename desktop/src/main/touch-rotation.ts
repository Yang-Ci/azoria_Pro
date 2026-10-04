import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TouchRotation, TouchRotationSettings } from "../shared/contracts"

const rotations: readonly TouchRotation[] = [0, 90, 180, 270]

function validRotation(value: unknown): value is TouchRotation {
  return typeof value === "number" && rotations.includes(value as TouchRotation)
}

export class TouchRotationManager {
  private readonly settingsPath: string
  private degrees: TouchRotation = 0
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {
    this.settingsPath = path.join(directory, "touch-rotation.json")
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<TouchRotationSettings>
      this.degrees = validRotation(parsed.degrees) ? parsed.degrees : 0
    } catch {
      this.degrees = 0
    }
  }

  settings(): TouchRotationSettings {
    return { degrees: this.degrees }
  }

  rotateClockwise(): Promise<TouchRotationSettings> {
    const operation = this.pending.then(async () => {
      const index = rotations.indexOf(this.degrees)
      const degrees = rotations[(index + 1) % rotations.length]!
      const temporaryPath = `${this.settingsPath}.tmp`
      await writeFile(temporaryPath, JSON.stringify({ degrees }, null, 2), { mode: 0o600 })
      await rename(temporaryPath, this.settingsPath)
      this.degrees = degrees
      return this.settings()
    })
    this.pending = operation.then(() => undefined, () => undefined)
    return operation
  }
}

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ServerResponse } from "node:http"
import type { WallpaperInfo, WallpaperKind, WallpaperUpload } from "../shared/contracts"

const headerSize = 20
const maxPackageSize = 3_200_000
const maxFrames = 120

function readUInt16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8)
}

function readUInt32(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
}

function validatePackage(data: Uint8Array, kind: WallpaperKind): { frameCount: number; durationMs: number } {
  if (data.byteLength < headerSize + 8 || data.byteLength > maxPackageSize) throw new Error("壁纸包大小无效")
  if (String.fromCharCode(...data.subarray(0, 4)) !== "AZW1") throw new Error("壁纸包格式无效")
  if (readUInt16(data, 4) !== 480 || readUInt16(data, 6) !== 480) throw new Error("壁纸必须为 480 × 480")
  const frameCount = readUInt16(data, 8)
  const frameDelayMs = readUInt16(data, 10)
  const payloadSize = readUInt32(data, 12)
  if (frameCount < 1 || frameCount > maxFrames || payloadSize !== data.byteLength - headerSize) throw new Error("壁纸帧信息无效")
  if ((kind === "image" && (frameCount !== 1 || frameDelayMs !== 0)) ||
      (kind === "video" && (frameCount < 2 || frameDelayMs < 100 || frameDelayMs > 2000))) {
    throw new Error("壁纸类型与动画帧不匹配")
  }
  let offset = headerSize
  for (let index = 0; index < frameCount; index++) {
    if (offset + 4 > data.byteLength) throw new Error("壁纸帧不完整")
    const length = readUInt32(data, offset)
    offset += 4
    if (length < 128 || length > 600_000 || offset + length > data.byteLength ||
        data[offset] !== 0xff || data[offset + 1] !== 0xd8 ||
        data[offset + length - 2] !== 0xff || data[offset + length - 1] !== 0xd9) {
      throw new Error("壁纸 JPEG 帧无效")
    }
    offset += length
  }
  if (offset !== data.byteLength) throw new Error("壁纸包包含多余数据")
  return { frameCount, durationMs: frameCount * frameDelayMs }
}

export class WallpaperManager {
  private readonly packagePath: string
  private readonly metadataPath: string
  private current: WallpaperInfo | null = null

  constructor(private readonly directory: string) {
    this.packagePath = path.join(directory, "wallpaper.azw")
    this.metadataPath = path.join(directory, "wallpaper.json")
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const [data, rawMetadata] = await Promise.all([readFile(this.packagePath), readFile(this.metadataPath, "utf8")])
      const metadata = JSON.parse(rawMetadata) as WallpaperInfo
      if (!metadata || !["image", "video"].includes(metadata.kind) ||
          typeof metadata.name !== "string" || typeof metadata.updatedAt !== "string") {
        throw new Error("壁纸元数据无效")
      }
      const validation = validatePackage(data, metadata.kind)
      const sha256 = createHash("sha256").update(data).digest("hex")
      if (metadata.sha256 !== sha256 || metadata.size !== data.byteLength ||
          metadata.frameCount !== validation.frameCount || metadata.durationMs !== validation.durationMs) throw new Error("壁纸元数据不匹配")
      this.current = metadata
    } catch {
      this.current = null
    }
  }

  info(): WallpaperInfo | null {
    return this.current ? { ...this.current } : null
  }

  async upload(input: WallpaperUpload): Promise<WallpaperInfo> {
    if (!input || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 160 ||
        !["image", "video"].includes(input.kind) || !(input.data instanceof Uint8Array)) {
      throw new Error("壁纸上传参数无效")
    }
    const data = Buffer.from(input.data)
    const validation = validatePackage(data, input.kind)
    const info: WallpaperInfo = {
      name: path.basename(input.name),
      kind: input.kind,
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      frameCount: validation.frameCount,
      durationMs: validation.durationMs,
      updatedAt: new Date().toISOString(),
    }
    const temporaryPackage = `${this.packagePath}.tmp`
    const temporaryMetadata = `${this.metadataPath}.tmp`
    await writeFile(temporaryPackage, data, { mode: 0o600 })
    await writeFile(temporaryMetadata, JSON.stringify(info, null, 2), { mode: 0o600 })
    await rename(temporaryPackage, this.packagePath)
    await rename(temporaryMetadata, this.metadataPath)
    this.current = info
    return { ...info }
  }

  async remove(): Promise<void> {
    await Promise.all([
      rm(this.packagePath, { force: true }),
      rm(this.metadataPath, { force: true }),
    ])
    this.current = null
  }

  stream(response: ServerResponse): void {
    const info = this.current
    if (!info) {
      response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      response.end(JSON.stringify({ ok: false, error: "wallpaper not found" }))
      return
    }
    response.writeHead(200, {
      "Content-Type": "application/vnd.azoria.wallpaper",
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
      "X-Azoria-SHA256": info.sha256,
    })
    const stream = createReadStream(this.packagePath)
    stream.on("error", () => response.destroy())
    stream.pipe(response)
  }
}

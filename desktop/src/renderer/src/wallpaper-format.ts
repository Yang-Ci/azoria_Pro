import type { WallpaperKind, WallpaperUpload } from "../../shared/contracts"

const displayWidth = 480
const displayHeight = 480
const animationWidth = 480
const animationHeight = 480
const headerSize = 20
const flashPackageSize = 3 * 1024 * 1024 - 64 * 1024
const tfPackageSize = 24 * 1024 * 1024 - 64 * 1024
const maxVideoDurationSeconds = 10
const targetFrameCount = 25
const minimumVideoFrameDelayMs = 400
const videoExtensions = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv"])
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"])

export interface WallpaperCrop { x: number; y: number; zoom: number }
export const defaultWallpaperCrop: WallpaperCrop = { x: 0.5, y: 0.5, zoom: 1 }

export function wallpaperKind(file: Pick<File, "name" | "type">): WallpaperKind {
  const extension = file.name.toLowerCase().split(".").at(-1) || ""
  if (file.type.startsWith("video/") || videoExtensions.has(extension)) return "video"
  if (file.type.startsWith("image/") || imageExtensions.has(extension)) return "image"
  throw new Error("请选择图片或视频文件")
}

export function wallpaperCropRect(width: number, height: number, crop = defaultWallpaperCrop) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || !Number.isFinite(crop.zoom)) throw new Error("壁纸裁切参数无效")
  const size = Math.min(width, height) / Math.min(3, Math.max(1, crop.zoom))
  return { x: (width - size) * Math.min(1, Math.max(0, crop.x)), y: (height - size) * Math.min(1, Math.max(0, crop.y)), size }
}

function waitFor(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("媒体读取超时")), 15_000)
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      target.removeEventListener(event, onReady)
      target.removeEventListener("error", onError)
      error ? reject(error) : resolve()
    }
    const onReady = () => finish()
    const onError = () => finish(new Error("无法读取所选媒体"))
    target.addEventListener(event, onReady, { once: true })
    target.addEventListener("error", onError, { once: true })
  })
}

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, crop: WallpaperCrop): void {
  const targetWidth = context.canvas.width
  const targetHeight = context.canvas.height
  const rect = wallpaperCropRect(sourceWidth, sourceHeight, crop)
  context.fillStyle = "#000"
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, rect.x, rect.y, rect.size, rect.size, 0, 0, targetWidth, targetHeight)
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) return reject(new Error("壁纸压缩失败"))
    void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
  }, "image/jpeg", quality))
}

function buildPackage(frames: Uint8Array[], frameDelayMs: number, sourceWidth: number, sourceHeight: number): Uint8Array {
  const payloadSize = frames.reduce((total, frame) => total + 4 + frame.byteLength, 0)
  const output = new Uint8Array(headerSize + payloadSize)
  output.set(frameDelayMs > 0
    ? [0x41, 0x5a, 0x57, 0x34]
    : [0x41, 0x5a, 0x57, 0x31])
  const view = new DataView(output.buffer)
  view.setUint16(4, sourceWidth, true)
  view.setUint16(6, sourceHeight, true)
  view.setUint16(8, frames.length, true)
  view.setUint16(10, frameDelayMs, true)
  view.setUint32(12, payloadSize, true)
  let offset = headerSize
  for (const frame of frames) {
    view.setUint32(offset, frame.byteLength, true)
    offset += 4
    output.set(frame, offset)
    offset += frame.byteLength
  }
  return output
}

async function encodeImage(file: File, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, crop: WallpaperCrop): Promise<Uint8Array[]> {
  const bitmap = await createImageBitmap(file)
  try {
    drawCover(context, bitmap, bitmap.width, bitmap.height, crop)
    return [await canvasJpeg(canvas, 0.86)]
  } finally {
    bitmap.close()
  }
}

async function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.001) return
  const ready = waitFor(video, "seeked")
  video.currentTime = seconds
  await ready
}

async function encodeVideo(file: File, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, packageLimit: number, crop: WallpaperCrop, onProgress?: (percent: number) => void): Promise<{ frames: Uint8Array[]; delay: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.muted = true
  video.preload = "auto"
  video.playsInline = true
  video.src = url
  try {
    await waitFor(video, "loadeddata")
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth < 1 || video.videoHeight < 1) {
      throw new Error("视频时长或尺寸无效")
    }
    const duration = Math.min(video.duration, maxVideoDurationSeconds)
    const delay = Math.max(minimumVideoFrameDelayMs, Math.ceil((duration * 1000) / targetFrameCount))
    const frameCount = Math.min(targetFrameCount, Math.max(2, Math.round((duration * 1000) / delay)))
    const frames: Uint8Array[] = []
    let packageSize = headerSize
    for (let index = 0; index < frameCount; index += 1) {
      const time = (index * delay) / 1000
      await seek(video, Math.min(time, Math.max(0, video.duration - 0.02)))
      drawCover(context, video, video.videoWidth, video.videoHeight, crop)
      const frame = await canvasJpeg(canvas, 0.78)
      if (packageSize + 4 + frame.byteLength > packageLimit) break
      frames.push(frame)
      packageSize += 4 + frame.byteLength
      onProgress?.(Math.round((index + 1) / frameCount * 100))
    }
    if (frames.length < 2) throw new Error("视频压缩后仍超过 Touch 存储限制，请选择更短或画面更简单的视频")
    return { frames, delay }
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function createWallpaperUpload(file: File, packageLimit = flashPackageSize, crop = defaultWallpaperCrop, onProgress?: (percent: number) => void): Promise<WallpaperUpload> {
  if (!Number.isFinite(packageLimit) || packageLimit < 1024) throw new Error("Touch 存储空间不足")
  const safePackageLimit = Math.min(tfPackageSize, Math.floor(packageLimit))
  const kind = wallpaperKind(file)
  const canvas = document.createElement("canvas")
  canvas.width = kind === "video" ? animationWidth : displayWidth
  canvas.height = kind === "video" ? animationHeight : displayHeight
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("当前系统无法处理壁纸")
  if (kind === "image") {
    const frames = await encodeImage(file, canvas, context, crop)
    const data = buildPackage(frames, 0, displayWidth, displayHeight)
    if (data.byteLength > safePackageLimit) throw new Error("图片压缩后仍超过 Touch 存储限制，请选择画面更简单的图片")
    onProgress?.(100)
    return { name: file.name, kind, data }
  }
  const { frames, delay } = await encodeVideo(file, canvas, context, safePackageLimit, crop, onProgress)
  onProgress?.(100)
  return { name: file.name, kind, data: buildPackage(frames, delay, animationWidth, animationHeight) }
}

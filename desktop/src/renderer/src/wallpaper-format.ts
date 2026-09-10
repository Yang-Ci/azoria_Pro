import type { WallpaperKind, WallpaperUpload } from "../../shared/contracts"

const width = 480
const height = 480
const headerSize = 20
const flashPackageSize = 3_150_000
const tfPackageSize = 24 * 1024 * 1024 - 64 * 1024
const maxVideoDurationSeconds = 20
const targetFrameCount = 120
const videoExtensions = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv"])
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"])

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

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number): void {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const drawnWidth = sourceWidth * scale
  const drawnHeight = sourceHeight * scale
  context.fillStyle = "#000"
  context.fillRect(0, 0, width, height)
  context.drawImage(source, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight)
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) return reject(new Error("壁纸压缩失败"))
    void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
  }, "image/jpeg", quality))
}

function buildPackage(frames: Uint8Array[], frameDelayMs: number): Uint8Array {
  const payloadSize = frames.reduce((total, frame) => total + 4 + frame.byteLength, 0)
  const output = new Uint8Array(headerSize + payloadSize)
  output.set([0x41, 0x5a, 0x57, 0x31])
  const view = new DataView(output.buffer)
  view.setUint16(4, width, true)
  view.setUint16(6, height, true)
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

async function encodeImage(file: File, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Promise<Uint8Array[]> {
  const bitmap = await createImageBitmap(file)
  try {
    drawCover(context, bitmap, bitmap.width, bitmap.height)
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

async function encodeVideo(file: File, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, packageLimit: number): Promise<{ frames: Uint8Array[]; delay: number }> {
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
    const delay = Math.max(160, Math.ceil((duration * 1000) / targetFrameCount))
    const frames: Uint8Array[] = []
    let packageSize = headerSize
    for (let time = 0; time < duration && frames.length < targetFrameCount; time += delay / 1000) {
      await seek(video, Math.min(time, Math.max(0, video.duration - 0.02)))
      drawCover(context, video, video.videoWidth, video.videoHeight)
      const frame = await canvasJpeg(canvas, 0.64)
      if (packageSize + 4 + frame.byteLength > packageLimit) break
      frames.push(frame)
      packageSize += 4 + frame.byteLength
    }
    if (frames.length < 2) throw new Error("视频压缩后仍超过 Touch 存储限制，请选择更短或画面更简单的视频")
    return { frames, delay }
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function createWallpaperUpload(file: File, packageLimit = flashPackageSize): Promise<WallpaperUpload> {
  const safePackageLimit = Math.min(tfPackageSize, Math.max(flashPackageSize, Math.floor(packageLimit)))
  const extension = file.name.toLowerCase().split(".").at(-1) || ""
  const kind: WallpaperKind = file.type.startsWith("video/") || videoExtensions.has(extension)
    ? "video"
    : file.type.startsWith("image/") || imageExtensions.has(extension)
      ? "image"
      : (() => { throw new Error("请选择图片或视频文件") })()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("当前系统无法处理壁纸")
  if (kind === "image") {
    const frames = await encodeImage(file, canvas, context)
    return { name: file.name, kind, data: buildPackage(frames, 0) }
  }
  const { frames, delay } = await encodeVideo(file, canvas, context, safePackageLimit)
  return { name: file.name, kind, data: buildPackage(frames, delay) }
}

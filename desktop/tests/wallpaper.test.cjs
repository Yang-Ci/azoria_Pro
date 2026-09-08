const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const filename = path.resolve(__dirname, '../src/main/wallpaper.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
const { transformSync } = require('esbuild')
compiled._compile(transformSync(require('node:fs').readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code, filename)
const { WallpaperManager } = compiled.exports

function wallpaperPackage(frameCount = 1, delay = 0) {
  const jpeg = Buffer.alloc(128, 0x55)
  jpeg[0] = 0xff
  jpeg[1] = 0xd8
  jpeg[126] = 0xff
  jpeg[127] = 0xd9
  const payloadSize = frameCount * (4 + jpeg.length)
  const data = Buffer.alloc(20 + payloadSize)
  data.write('AZW1', 0)
  data.writeUInt16LE(480, 4)
  data.writeUInt16LE(480, 6)
  data.writeUInt16LE(frameCount, 8)
  data.writeUInt16LE(delay, 10)
  data.writeUInt32LE(payloadSize, 12)
  let offset = 20
  for (let index = 0; index < frameCount; index++) {
    data.writeUInt32LE(jpeg.length, offset)
    offset += 4
    jpeg.copy(data, offset)
    offset += jpeg.length
  }
  return data
}

test('wallpaper package is validated, persisted and restored', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-wallpaper-'))
  try {
    const manager = new WallpaperManager(directory)
    await manager.initialize()
    assert.equal(manager.info(), null)

    const info = await manager.upload({ name: 'photo.jpg', kind: 'image', data: wallpaperPackage() })
    assert.equal(info.frameCount, 1)
    assert.equal(info.durationMs, 0)
    assert.equal(info.sha256.length, 64)

    const restored = new WallpaperManager(directory)
    await restored.initialize()
    assert.deepEqual(restored.info(), info)
    await restored.remove()
    assert.equal(restored.info(), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('wallpaper kind must match the package animation frames', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-wallpaper-'))
  try {
    const manager = new WallpaperManager(directory)
    await manager.initialize()
    await assert.rejects(
      () => manager.upload({ name: 'clip.mp4', kind: 'video', data: wallpaperPackage() }),
      /类型与动画帧不匹配/,
    )
    const info = await manager.upload({ name: 'clip.mp4', kind: 'video', data: wallpaperPackage(2, 200) })
    assert.equal(info.durationMs, 400)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

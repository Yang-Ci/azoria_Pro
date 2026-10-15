const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

// Exercise extraction, compression and packaging together.
// Media events and JPEG sizes are deterministic; hardware decode is measured
// separately through WALLPAPER_PLAYBACK diagnostics.
function encoder(duration, jpegSize = () => 128) {
  const seeks = [], qualities = [], progress = []
  let cleanedUp = false, revoked = false
  class Video extends EventTarget {
    duration = duration
    videoWidth = 1920
    videoHeight = 1080
    time = 0
    set src(value) { queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))) }
    get currentTime() { return this.time }
    set currentTime(value) {
      this.time = value
      seeks.push(value)
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
    }
    removeAttribute() { cleanedUp = true }
    load() {}
  }
  const canvas = {
    getContext: () => ({ canvas, fillRect() {}, drawImage() {} }),
    toBlob(callback, type, quality) {
      qualities.push(quality)
      const jpeg = new Uint8Array(jpegSize(quality))
      jpeg.set([0xff, 0xd8])
      jpeg.set([0xff, 0xd9], jpeg.length - 2)
      callback({ arrayBuffer: async () => jpeg.buffer })
    },
  }
  const compiled = { exports: {} }
  const file = path.resolve(__dirname, '../src/renderer/src/wallpaper-format.ts')
  vm.runInNewContext(transformSync(readFileSync(file, 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node20',
  }).code, {
    module: compiled, exports: compiled.exports, Uint8Array, DataView,
    window: { setTimeout, clearTimeout },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked = true } },
    document: { createElement: tag => tag === 'video' ? new Video() : canvas },
  })
  return {
    encode: limit => compiled.exports.createWallpaperUpload({ name: 'clip.mp4', type: 'video/mp4' }, limit, undefined, value => progress.push(value)),
    seeks, qualities, progress, canvas,
    released: () => cleanedUp && revoked,
  }
}

test('native video retains the first 10 seconds at the accepted six-frame cadence', async () => {
  const fixture = encoder(30)
  const upload = await fixture.encode()
  const header = new DataView(upload.data.buffer)
  assert.equal(Buffer.from(upload.data.subarray(0, 4)).toString(), 'AZW4')
  assert.equal(header.getUint16(4, true), 480)
  assert.equal(header.getUint16(6, true), 480)
  assert.equal(header.getUint16(8, true), 60)
  assert.equal(header.getUint16(10, true), 166)
  assert.equal(fixture.seeks.at(-1), 9.794)
  assert.ok(header.getUint16(8, true) * header.getUint16(10, true) <= 10_000)
  assert.equal(header.getUint32(12, true), upload.data.length - 20)
  assert.equal(fixture.progress.at(-1), 100)
  assert.ok(fixture.released())
})

test('storage pressure uses fine JPEG quality steps without truncating the loop', async () => {
  const fixture = encoder(10, quality => quality > 0.74 ? 1200 : 600)
  const upload = await fixture.encode(40_000)
  assert.ok(upload.data.length <= 40_000)
  assert.equal(new DataView(upload.data.buffer).getUint16(8, true), 60)
  assert.equal(fixture.seeks.at(-1), 9.794)
  assert.ok(fixture.qualities.includes(0.74))
  assert.ok(!fixture.qualities.includes(0.66))
  assert.ok(fixture.released())
})

test('sufficient storage preserves the accepted JPEG quality', async () => {
  const fixture = encoder(10)
  await fixture.encode()
  assert.equal(fixture.qualities.length, 60)
  assert.ok(fixture.qualities.every(quality => quality === 0.78))
})

test('unsatisfiable budgets reject the clip and release media resources', async () => {
  const fixture = encoder(10, () => 1200)
  await assert.rejects(fixture.encode(40_000), /超过 Touch 存储限制/)
  assert.ok(fixture.released())
  assert.notEqual(fixture.progress.at(-1), 100)
})

test('short clips preserve their duration instead of being extended to ten seconds', async () => {
  const fixture = encoder(0.3)
  const upload = await fixture.encode()
  const header = new DataView(upload.data.buffer)
  assert.equal(header.getUint16(8, true), 2)
  assert.equal(header.getUint16(10, true), 150)
  assert.equal(fixture.seeks.at(-1), 0.15)
  assert.ok(fixture.released())
})

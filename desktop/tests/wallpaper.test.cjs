const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm, readFile, writeFile, mkdir } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { createServer } = require('node:http')
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

async function fixture(t, now) {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-wallpaper-library-'))
  const manager = new WallpaperManager(directory, now)
  t.after(async () => { manager.stop(); await rm(directory, { recursive: true, force: true }) })
  await manager.initialize()
  const upload = (name, fill) => manager.upload({ name, kind: 'image', data: wallpaperPackage(1, 0, fill) })
  return { directory, manager, upload }
}

function wallpaperPackage(frameCount = 1, delay = 0, fill = 0x55) {
  const jpeg = Buffer.alloc(128, fill)
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
    assert.deepEqual(manager.settings(), { idleMinutes: 5 })

    const info = await manager.upload({ name: 'photo.jpg', kind: 'image', data: wallpaperPackage() })
    assert.equal(info.frameCount, 1)
    assert.equal(info.durationMs, 0)
    assert.equal(info.sha256.length, 64)

    const restored = new WallpaperManager(directory)
    await restored.initialize()
    assert.deepEqual(restored.info(), info)
    await restored.setIdleMinutes(30)
    const restoredSettings = new WallpaperManager(directory)
    await restoredSettings.initialize()
    assert.deepEqual(restoredSettings.settings(), { idleMinutes: 30 })
    await assert.rejects(() => restoredSettings.setIdleMinutes(2), /自动壁纸时间无效/)
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

test('library keeps multiple wallpapers, deduplicates content and restores selection and settings', async t => {
  const { directory, manager, upload } = await fixture(t)
  const a = await upload('a.jpg', 0x11)
  const b = await upload('b.jpg', 0x22)
  await upload('b renamed.jpg', 0x22)
  assert.equal(manager.library().items.length, 2)
  assert.equal(manager.library().items.find(item => item.id === b.id).name, 'b renamed.jpg')
  await manager.activate(a.id)
  await manager.setPlayback({ enabled: true, intervalMinutes: 15, order: 'random', playlist: [b.id, a.id], schedules: [{ id: 'evening', time: '22:00', wallpaperId: b.id, enabled: true }] })
  const restored = new WallpaperManager(directory)
  await restored.initialize()
  assert.equal(restored.library().activeId, a.id)
  assert.deepEqual(restored.library().playback, manager.library().playback)
  assert.match(await restored.preview(b.id), /^data:image\/jpeg;base64,/)
  await assert.rejects(() => restored.preview('../wallpaper'), /标识无效/)
})

test('legacy wallpaper and idle preference migrate without deleting the original files', async t => {
  const { directory } = await fixture(t)
  await rm(path.join(directory, 'wallpaper-library/library.json'))
  const data = wallpaperPackage()
  const metadata = { name: 'old.jpg', kind: 'image', size: data.length, sha256: createHash('sha256').update(data).digest('hex'), frameCount: 1, durationMs: 0, updatedAt: new Date().toISOString() }
  await writeFile(path.join(directory, 'wallpaper.azw'), data)
  await writeFile(path.join(directory, 'wallpaper.json'), JSON.stringify(metadata))
  await writeFile(path.join(directory, 'wallpaper-settings.json'), JSON.stringify({ idleMinutes: 10 }))
  const migrated = new WallpaperManager(directory)
  await migrated.initialize()
  assert.equal(migrated.info().sha256, metadata.sha256)
  assert.equal(migrated.library().items.length, 1)
  assert.deepEqual(migrated.settings(), { idleMinutes: 10 })
  assert.deepEqual(await readFile(path.join(directory, 'wallpaper.azw')), data)
  assert.deepEqual(await readFile(path.join(directory, 'wallpaper-library', `${metadata.sha256}.azw`)), data)
})

test('sequential rotation respects interval, wraps and resets after a manual selection', async t => {
  let now = new Date(2026, 9, 4, 12).getTime()
  const { manager, upload } = await fixture(t, () => now)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22)
  await manager.activate(a.id)
  await manager.setPlayback({ enabled: true, intervalMinutes: 1, order: 'sequential', playlist: [a.id, b.id], schedules: [] })
  now += 59_999; await manager.tick()
  assert.equal(manager.library().activeId, a.id)
  now++; await manager.tick()
  assert.equal(manager.library().activeId, b.id)
  now += 60_000; await manager.tick()
  assert.equal(manager.library().activeId, a.id)
  now += 30_000; await manager.activate(b.id)
  now += 59_999; await manager.tick()
  assert.equal(manager.library().activeId, b.id)
  now++; await manager.tick()
  assert.equal(manager.library().activeId, a.id)
})

test('random rotation never immediately repeats when alternatives exist', async t => {
  const { manager, upload } = await fixture(t)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22), c = await upload('c.jpg', 0x33)
  await manager.setPlayback({ enabled: true, intervalMinutes: 1, order: 'random', playlist: [a.id, b.id, c.id], schedules: [] })
  for (let index = 0; index < 8; index++) {
    const previous = manager.library().activeId
    await manager.next()
    assert.notEqual(manager.library().activeId, previous)
    assert.ok([a.id, b.id, c.id].includes(manager.library().activeId))
  }
})

test('daily schedules work across midnight and wakeup, run once and take priority over rotation', async t => {
  let now = new Date(2026, 9, 4, 23, 59, 30).getTime()
  const { manager, upload } = await fixture(t, () => now)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22), c = await upload('c.jpg', 0x33)
  await manager.activate(a.id)
  await manager.setPlayback({ enabled: true, intervalMinutes: 1, order: 'sequential', playlist: [a.id, b.id, c.id], schedules: [
    { id: 'midnight', time: '00:00', wallpaperId: c.id, enabled: true }, { id: 'morning', time: '07:00', wallpaperId: b.id, enabled: true },
  ] })
  now = new Date(2026, 9, 5, 0, 0, 35).getTime(); await manager.tick()
  assert.equal(manager.library().activeId, c.id)
  await manager.activate(a.id); await manager.tick()
  assert.equal(manager.library().activeId, a.id, 'schedule must not undo a manual change within the same minute')
  now = new Date(2026, 9, 5, 8).getTime(); await manager.tick()
  assert.equal(manager.library().activeId, b.id, 'latest missed rule is applied on wakeup')
  await manager.remove()
  now = new Date(2026, 9, 6, 8).getTime(); await manager.tick()
  assert.equal(manager.info(), null)
  assert.equal(manager.library().items.length, 3, 'stopping playback preserves the library')
  assert.equal(manager.library().nextSwitchAt, null)
})

test('deleting current wallpaper chooses the next item and prunes playlist and rules', async t => {
  const { directory, manager, upload } = await fixture(t)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22), c = await upload('c.jpg', 0x33)
  await manager.setPlayback({ enabled: true, intervalMinutes: 5, order: 'sequential', playlist: [a.id, b.id, c.id], schedules: [{ id: 'noon', time: '12:00', wallpaperId: b.id, enabled: true }] })
  await manager.activate(b.id)
  await manager.deleteItem(b.id)
  assert.equal(manager.library().activeId, c.id)
  assert.deepEqual(manager.library().playback.playlist, [a.id, c.id])
  assert.deepEqual(manager.library().playback.schedules, [])
  await manager.deleteItem(c.id)
  assert.equal(manager.library().playback.enabled, false)
  await manager.deleteItem(a.id)
  assert.equal(manager.info(), null)
  const restored = new WallpaperManager(directory)
  await restored.initialize()
  assert.deepEqual(restored.library().items, [])
})

test('invalid settings and damaged assets do not replace the current wallpaper', async t => {
  const { directory, manager, upload } = await fixture(t)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22)
  await manager.activate(a.id)
  const settings = { enabled: true, intervalMinutes: 5, order: 'sequential', playlist: [a.id, b.id], schedules: [] }
  await assert.rejects(() => manager.setPlayback({ ...settings, intervalMinutes: 0 }), /播放设置无效/)
  await assert.rejects(() => manager.setPlayback({ ...settings, playlist: ['../bad'] }), /不存在/)
  await assert.rejects(() => manager.setPlayback({ ...settings, playlist: [a.id] }), /至少需要两张/)
  await assert.rejects(() => manager.setPlayback({ ...settings, schedules: [{ id: 'bad', time: '24:00', wallpaperId: a.id, enabled: true }] }), /规则无效/)
  await assert.rejects(() => manager.setPlayback({ ...settings, schedules: [{ id: 'a', time: '12:00', wallpaperId: a.id, enabled: true }, { id: 'b', time: '12:00', wallpaperId: b.id, enabled: true }] }), /同一时间/)
  await writeFile(path.join(directory, 'wallpaper-library', `${b.id}.azw`), wallpaperPackage(1, 0, 0x33))
  await assert.rejects(() => manager.activate(b.id), /校验失败/)
  assert.equal(manager.library().activeId, a.id)
})

test('serialized imports and streaming keep the response hash paired with its bytes during a switch', async t => {
  const { manager, upload } = await fixture(t)
  const [a, b, c] = await Promise.all([upload('a.jpg', 0x11), upload('b.jpg', 0x22), upload('c.jpg', 0x33)])
  assert.equal(manager.library().items.length, 3)
  await manager.activate(a.id)
  const server = createServer((_request, response) => { manager.stream(response); void manager.activate(b.id) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(response.headers.get('X-Azoria-SHA256'), a.sha256)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), a.sha256)
  assert.equal(Number(response.headers.get('Content-Length')), a.size)
  assert.ok(manager.library().items.some(item => item.id === c.id))
})

test('failed manifest writes leave the in-memory and persisted selection intact', async t => {
  const { directory, manager, upload } = await fixture(t)
  const a = await upload('a.jpg', 0x11), b = await upload('b.jpg', 0x22)
  await manager.activate(a.id)
  const temp = path.join(directory, 'wallpaper-library/library.json.tmp')
  await mkdir(temp)
  await assert.rejects(() => manager.activate(b.id))
  assert.equal(manager.library().activeId, a.id)
  const manifest = JSON.parse(await readFile(path.join(directory, 'wallpaper-library/library.json'), 'utf8'))
  assert.equal(manifest.activeId, a.id)
})

test('damaged manifests preserve existing files and do not prevent other desktop features from starting', async t => {
  const { directory, upload } = await fixture(t)
  const item = await upload('saved.jpg', 0x11)
  const manifest = path.join(directory, 'wallpaper-library/library.json')
  await writeFile(manifest, '{broken')
  const restored = new WallpaperManager(directory)
  await restored.initialize()
  assert.match(restored.library().error, /读取失败/)
  await assert.rejects(() => restored.upload({ name: 'new.jpg', kind: 'image', data: wallpaperPackage() }), /读取失败/)
  assert.equal(await readFile(manifest, 'utf8'), '{broken')
  assert.ok((await readFile(path.join(directory, 'wallpaper-library', `${item.id}.azw`))).length > 0)
})

test('crop geometry matches square output for landscape, portrait and zoomed edge positions', () => {
  const file = path.resolve(__dirname, '../src/renderer/src/wallpaper-format.ts')
  const cropModule = new Module(file, module)
  cropModule.paths = module.paths
  cropModule._compile(transformSync(require('node:fs').readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file)
  const { wallpaperCropRect } = cropModule.exports
  assert.deepEqual(wallpaperCropRect(1920, 1080), { x: 420, y: 0, size: 1080 })
  assert.deepEqual(wallpaperCropRect(1080, 1920), { x: 0, y: 420, size: 1080 })
  assert.deepEqual(wallpaperCropRect(1920, 1080, { x: 1, y: 1, zoom: 2 }), { x: 1380, y: 540, size: 540 })
  assert.deepEqual(wallpaperCropRect(480, 480, { x: 0, y: 0, zoom: 1 }), { x: 0, y: 0, size: 480 })
  assert.throws(() => wallpaperCropRect(0, 480), /裁切参数无效/)
})

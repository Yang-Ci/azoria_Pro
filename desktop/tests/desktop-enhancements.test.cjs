const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

function load(relative) {
  const filename = path.resolve(__dirname, '../src', relative)
  const compiled = new Module(filename, module)
  compiled.paths = module.paths
  compiled._compile(buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20' }).outputFiles[0].text, filename)
  return compiled.exports
}
const { BrightnessLinkManager, offsetRange } = load('main/brightness-link.ts')
const { cpuUsage, networkRates, ComputerStatsService } = load('main/computer.ts')
const { computerTouchStatus, computerBlePage } = load('shared/computer.ts')
const { DesktopPreferencesManager, defaultDesktopPreferences, validateDesktopPreferences } = load('main/desktop-preferences.ts')

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'azoria-enhancements-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const brightness = new Map([['primary', 60], ['secondary', 40]])
  const writes = [], failures = new Set()
  const monitor = {
    connectionSnapshot: () => ({ displayId: 'primary' }), snapshot: () => ({ brightness: brightness.get('primary'), volume: 20, mute: false, input: 'usbc' }),
    acceptBrightness: () => {}, brightness: async () => brightness.get('primary'),
    coordinateBrightness: async operation => operation(),
    control: async request => { writes.push(['single', request.value]); brightness.set('primary', request.value); return monitor.snapshot() },
    forDisplay: async displayId => {
      if (!brightness.has(displayId) || failures.has(displayId)) throw new Error('display disconnected')
      return { brightness: async () => brightness.get(displayId), control: async request => { writes.push([displayId, request.value]); brightness.set(displayId, request.value); return { brightness: request.value } } }
    },
  }
  const link = new BrightnessLinkManager(directory, monitor)
  await link.initialize()
  const settings = { enabled: true, displays: [{ displayId: 'primary', baseline: 60 }, { displayId: 'secondary', baseline: 40 }] }
  return { directory, brightness, writes, failures, link, settings, monitor }
}

test('linked offsets preserve a 20-point gap at both bounds', async t => {
  const f = await fixture(t)
  await f.link.save(f.settings)
  assert.deepEqual(offsetRange(f.settings.displays), { minimumOffset: -40, maximumOffset: 40 })
  await f.link.setOffset(10)
  assert.equal(f.brightness.get('primary'), 70); assert.equal(f.brightness.get('secondary'), 50)
  await f.link.setOffset(100)
  assert.equal(f.brightness.get('primary'), 100); assert.equal(f.brightness.get('secondary'), 80)
  await f.link.setOffset(-100)
  assert.equal(f.brightness.get('primary'), 20); assert.equal(f.brightness.get('secondary'), 0)
})
test('Touch and desktop brightness share linked offsets and clamp their returned brightness', async t => {
  const f = await fixture(t); await f.link.save(f.settings)
  const status = await f.link.control({ control: 'brightness', value: 0, final: true }, 'touch')
  assert.equal(status.brightness, 20); assert.equal(f.brightness.get('secondary'), 0)
  await f.link.control({ control: 'brightness', value: 75, final: true }, 'desktop-ui')
  assert.equal(f.brightness.get('secondary'), 55)
})
test('one failed display leaves other displays controllable and reports its failure', async t => {
  const f = await fixture(t); await f.link.save(f.settings); f.failures.add('secondary')
  const state = await f.link.setOffset(5)
  assert.equal(f.brightness.get('primary'), 65)
  assert.equal(state.results[1].error, 'display disconnected')
  assert.equal(state.results[1].brightness, null)
  f.failures.delete('secondary'); await f.link.setOffset(5)
  assert.equal(f.brightness.get('secondary'), 45)
})
test('disabled linking adjusts only the selected display', async t => {
  const f = await fixture(t); await f.link.save({ ...f.settings, enabled: false })
  await f.link.control({ control: 'brightness', value: 80 }, 'desktop-ui')
  assert.equal(f.brightness.get('secondary'), 40)
  assert.deepEqual(f.writes, [['single', 80]])
})
test('linked queued previews coalesce while the final value is always applied', async t => {
  const f = await fixture(t); await f.link.save(f.settings)
  await Promise.all([f.link.control({ control: 'brightness', value: 61, final: false }, 'touch'), f.link.control({ control: 'brightness', value: 62, final: false }, 'touch'), f.link.control({ control: 'brightness', value: 70, final: true }, 'touch')])
  assert.deepEqual(f.writes, [['primary', 70], ['secondary', 50]])
})
test('scenes capture actual per-display values, persist and cycle', async t => {
  const f = await fixture(t); await f.link.save(f.settings); await f.link.setOffset(10)
  let state = await f.link.saveScene('Work')
  const first = state.scenes[0].id
  assert.deepEqual(state.scenes[0].displays.map(item => item.baseline), [70, 50])
  await f.link.setOffset(-20); state = await f.link.saveScene('Night')
  const second = state.scenes[1].id
  const restored = new BrightnessLinkManager(f.directory, f.monitor); await restored.initialize()
  assert.equal(restored.snapshot().scenes.length, 2)
  await restored.applyScene(first); assert.equal(f.brightness.get('primary'), 70)
  state = await restored.nextScene(); assert.equal(state.activeSceneId, second); assert.equal(f.brightness.get('secondary'), 20)
  state = await restored.deleteScene(second); assert.equal(state.activeSceneId, null); assert.equal(state.scenes.length, 1)
})
test('invalid baselines and duplicate display identities cannot be saved', async t => {
  const f = await fixture(t)
  await assert.rejects(f.link.save({ enabled: true, displays: [] }), /选择/)
  await assert.rejects(f.link.save({ enabled: true, displays: [{ displayId: 'primary', baseline: 101 }] }), /无效/)
  await assert.rejects(f.link.save({ ...f.settings, displays: [f.settings.displays[0], f.settings.displays[0]] }), /无效/)
  assert.equal(f.link.snapshot().enabled, false)
})
test('corrupt linked settings preserve the source file and start with linking disabled', async t => {
  const f = await fixture(t); const filename = path.join(f.directory, 'brightness-link.json')
  await writeFile(filename, '{broken')
  const restored = new BrightnessLinkManager(f.directory, f.monitor); await restored.initialize()
  assert.equal(restored.snapshot().enabled, false); assert.match(restored.snapshot().results[0].error, /读取失败/)
  assert.equal(await readFile(filename, 'utf8'), '{broken')
})
test('CPU usage derives from counter deltas and rejects warmup or resets', () => {
  assert.equal(cpuUsage(null, { idle: 40, total: 100 }), null)
  assert.equal(cpuUsage({ idle: 40, total: 100 }, { idle: 100, total: 200 }), 40)
  assert.equal(cpuUsage({ idle: 40, total: 100 }, { idle: 1, total: 2 }), null)
})
test('network speed handles large counters, disconnected adapters and counter resets', () => {
  const counter = (id, receivedBytes, sentBytes) => ({ id, name: id, receivedBytes: String(receivedBytes), sentBytes: String(sentBytes) })
  const before = [counter('wifi', 90071992547409930n, 1000), counter('old', 10000, 10000)]
  assert.deepEqual(networkRates(before, [counter('wifi', 90071992547413930n, 3000), counter('new', 50000, 50000)], 2), { rx: 2000, tx: 1000 })
  assert.equal(networkRates(before, [counter('wifi', 1, 1)], 2), null)
  assert.equal(networkRates(before, before, 16), null)
  assert.equal(networkRates(null, before, 2), null)
})
test('real CPU/memory sampling keeps a bounded history and survives network failures', async () => {
  let fail = true
  const stats = new ComputerStatsService('unused', async () => { if (fail) throw new Error('network unavailable'); return [] })
  await stats.sample(); assert.equal(stats.snapshot().available, true); assert.equal(stats.snapshot().cpuPercent, null)
  assert.equal(stats.snapshot().networkAvailable, false)
  fail = false
  for (let i = 0; i < 33; ++i) await stats.sample()
  const snapshot = stats.snapshot()
  assert.equal(snapshot.history.length, 30); assert.equal(snapshot.networkAvailable, true)
  assert.equal(snapshot.networkRxBps, 0); assert.ok(snapshot.memoryTotalBytes > 0)
  snapshot.history.length = 0; assert.equal(stats.snapshot().history.length, 30)
})
test('computer BLE pages stay within one characteristic and encode unavailable CPU samples', () => {
  const sample = { sampledAt: Date.now(), cpuPercent: null, memoryPercent: 100, memoryUsedBytes: 1048576, memoryTotalBytes: 2097152, networkRxBps: 2147483647, networkTxBps: 0 }
  const snapshot = { ...sample, available: true, networkAvailable: true, history: Array(30).fill(sample) }
  const status = computerTouchStatus(snapshot)
  assert.equal(status.statsCpuPercent, -1); assert.equal(status.statsMemoryUsedMb, 1)
  for (let page = 0; page < 3; ++page) assert.ok(Buffer.byteLength(`R|12345678|1234567890|${computerBlePage(status, page)}|0123456789abcdef`) < 512)
  assert.match(status.statsCpuTrend, /^-1,-1/)
  assert.throws(() => computerBlePage(status, 3))
})

async function preferencesFixture(t) {
  const f = await fixture(t)
  const registrations = new Map(); let startup = false; let blocked = ''
  const calls = []
  const adapter = { startupAvailable: true, getStartup: () => startup, setStartup: enabled => { startup = enabled; calls.push(enabled) },
    register: (key, action) => { if (key === blocked) return false; registrations.set(key, action); return true }, unregister: key => registrations.delete(key) }
  const preferences = new DesktopPreferencesManager(f.directory, adapter); await preferences.initialize()
  return { ...f, preferences, registrations, calls, adapter, block: key => { blocked = key } }
}
test('desktop defaults keep startup and global shortcuts opt-in', async t => {
  const f = await preferencesFixture(t)
  assert.equal(f.preferences.snapshot().closeToTray, true)
  assert.equal(f.preferences.snapshot().startAtLogin, false)
  assert.equal(f.preferences.snapshot().hotkeysEnabled, false)
  assert.deepEqual(f.calls, []); assert.equal(f.registrations.size, 0)
})
test('enabled shortcuts and startup persist and can be disabled cleanly', async t => {
  const f = await preferencesFixture(t)
  await f.preferences.update({ ...defaultDesktopPreferences, hotkeysEnabled: true, startAtLogin: true })
  assert.equal(f.registrations.size, 3); assert.deepEqual(f.calls, [true])
  assert.equal(JSON.parse(await readFile(path.join(f.directory, 'desktop-preferences.json'))).hotkeysEnabled, true)
  await f.preferences.update({ ...defaultDesktopPreferences, startAtLogin: false })
  assert.equal(f.registrations.size, 0); assert.deepEqual(f.calls, [true, false])
})
test('shortcut conflicts restore prior registrations and do not change startup', async t => {
  const f = await preferencesFixture(t)
  await f.preferences.update({ ...defaultDesktopPreferences, hotkeysEnabled: true })
  f.block('Ctrl+Alt+F12')
  await assert.rejects(f.preferences.update({ ...defaultDesktopPreferences, brightnessUp: 'Ctrl+Alt+F12', hotkeysEnabled: true, startAtLogin: true }), /占用/)
  assert.equal(f.registrations.size, 3); assert.equal(f.preferences.snapshot().brightnessUp, defaultDesktopPreferences.brightnessUp)
  assert.deepEqual(f.calls, [])
})
test('duplicate and unmodified key shortcuts are rejected before registration', () => {
  assert.throws(() => validateDesktopPreferences({ ...defaultDesktopPreferences, brightnessUp: 'Delete' }), /修饰键/)
  assert.throws(() => validateDesktopPreferences({ ...defaultDesktopPreferences, brightnessUp: defaultDesktopPreferences.brightnessDown }), /重复/)
})

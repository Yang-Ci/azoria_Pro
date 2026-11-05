const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const screens = new EventEmitter()
let displays = []
screens.getAllDisplays = () => displays
screens.getPrimaryDisplay = () => displays[0]
class Window extends EventEmitter {
  constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.destroyed = false; Window.instances.push(this) }
  isDestroyed() { return this.destroyed }
  setBounds(bounds) { this.bounds = bounds }
  loadFile(_file, options) { this.hash = options.hash; return Promise.resolve() }
  showInactive() { this.shown = true }
  destroy() { this.destroyed = true; this.emit('closed') }
}
Window.instances = []
const children = []
function spawnFake(file, args, options) {
  const child = new EventEmitter()
  child.args = args; child.options = options
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false
  child.kill = () => { child.killed = true; child.stdout.end(); child.stderr.end(); child.emit('exit', 0) }
  children.push(child)
  return child
}
const filename = path.resolve(__dirname, '../src/main/island.ts')
const code = buildSync({ entryPoints: [filename], bundle: true, external: ['electron'], write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const originalLoad = Module._load
const compiled = new Module(filename, module)
compiled.paths = module.paths
try {
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { BrowserWindow: Window, screen: screens }
    if (request === 'node:child_process') return { ...originalLoad.call(this, request, ...rest), spawn: spawnFake }
    return originalLoad.call(this, request, ...rest)
  }
  compiled._compile(code, filename)
} finally { Module._load = originalLoad }
const { IslandWindow, isIslandSupported } = compiled.exports

test('island supports Windows and X11 while leaving Wayland disabled', () => {
  assert.equal(isIslandSupported('win32', undefined, undefined), true)
  assert.equal(isIslandSupported('linux', 'x11', ':0'), true)
  assert.equal(isIslandSupported('linux', 'wayland', ':0'), false)
  assert.equal(isIslandSupported('linux', 'x11', undefined), false)
  assert.equal(isIslandSupported('darwin', undefined, undefined), false)
})

test('island persists its setting, follows the selected display and recovers when it disconnects', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yangci-island-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  displays = [{ id: 1, label: '主屏', workArea: { x: 0, y: 20, width: 1920, height: 1060 } }, { id: 2, label: '副屏', workArea: { x: -1280, y: 0, width: 1280, height: 1024 } }]
  const island = new IslandWindow(directory, false)
  island.supported = true
  t.after(() => island.dispose())
  await island.initialize()
  assert.equal(island.snapshot().enabled, false)
  await island.update({ enabled: true, displayId: '2', style: 'pill' })
  const window = Window.instances.at(-1)
  assert.equal(window.hash, 'island')
  assert.deepEqual(window.bounds, { x: -770, y: 0, width: 260, height: 56 })
  assert.equal(island.owns(window.webContents), true)
  assert.equal(island.owns({}), false)
  island.setExpanded(true)
  assert.equal(window.options.hasShadow, false)
  assert.deepEqual(window.bounds, { x: -860, y: 0, width: 440, height: 330 })
  displays = [displays[0]]
  screens.emit('display-removed')
  assert.deepEqual(window.bounds, { x: 740, y: 20, width: 440, height: 330 })
  await island.update({ enabled: false, displayId: '2', style: 'pill' })
  assert.equal(window.destroyed, true)
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'island-settings.json'), 'utf8')), { enabled: false, displayId: '2', style: 'pill' })
  await island.update({ enabled: true, displayId: '2', style: 'pill' })
  assert.deepEqual(Window.instances.at(-1).bounds, { x: 830, y: 20, width: 260, height: 56 })
  assert.throws(() => island.update({ enabled: true, displayId: 'unknown', style: 'pill' }), /无效/)
  assert.throws(() => island.update({ enabled: true, displayId: 'primary', style: 'daozai' }), /未安装/)
  await island.update({ enabled: false, displayId: 'primary', style: 'daozai' })
  assert.equal(island.snapshot().style, 'daozai')
})

test('managed island shares the parent tray for settings, notifications and startup', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yangci-island-tray-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  displays = [{ id: 1, label: '主屏', workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
  const notifications = [], startup = [], music = [], monitor = []
  const island = new IslandWindow(directory, true, { snapshot: async () => ({ usage: { usageCodexAvailable: true }, music: { track: { title: '测试歌曲' } } }), monitor: async (...args) => { monitor.push(args) }, music: async request => { music.push(request) }, notify: (...args) => notifications.push(args), setAutostart: async enabled => startup.push(enabled) })
  island.supported = true; island.nativePath = () => process.execPath
  t.after(() => island.dispose())
  await island.initialize()
  await island.update({ enabled: true, displayId: 'primary', style: 'daozai' })
  const child = children.at(-1)
  let sent = ''; child.stdin.on('data', chunk => { sent += chunk.toString() })
  island.openNativeSettings()
  child.stdout.write(JSON.stringify({ type: 'notification', title: '提醒', body: '该休息了', sound: false }) + '\n')
  child.stdout.write(JSON.stringify({ type: 'autostart', enabled: true }) + '\n')
  child.stdout.write(JSON.stringify({ type: 'music', request: { action: 'pause' } }) + '\n')
  child.stdout.write(JSON.stringify({ type: 'monitor', control: 'brightness', value: 63 }) + '\n')
  child.stdout.write(JSON.stringify({ type: 'music', request: { action: 'invalid' } }) + '\n')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(sent, /"command":"open-settings"/)
  assert.match(sent, /"usageCodexAvailable":true/)
  assert.match(sent, /测试歌曲/)
  assert.deepEqual(notifications, [['提醒', '该休息了', false]])
  assert.deepEqual(startup, [true])
  assert.deepEqual(music, [{ action: 'pause' }])
  assert.deepEqual(monitor, [['brightness', 63]])
  await island.update({ enabled: false, displayId: 'primary', style: 'daozai' })
  assert.equal(child.killed, true)
})

test('Linux native island follows the selected display and restores it after reconnection', { skip: process.platform !== 'linux' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yangci-island-displays-'))
  await writeFile(path.join(directory, 'settings.txt'), 'minimal=1\n')
  await writeFile(path.join(directory, 'ai-quota.json'), JSON.stringify({ enabled: true, compact: false, accounts: [{ source: 'private-login-path' }] }))
  const oldSource = process.env.DAOZAI_DATA_DIR; process.env.DAOZAI_DATA_DIR = directory
  t.after(async () => { if (oldSource === undefined) delete process.env.DAOZAI_DATA_DIR; else process.env.DAOZAI_DATA_DIR = oldSource; await rm(directory, { recursive: true, force: true }) })
  const primary = { id: 1, label: '主屏', workArea: { x: 0, y: 20, width: 1920, height: 1060 } }
  const secondary = { id: 2, label: '副屏', workArea: { x: -1280, y: 0, width: 1280, height: 1024 } }
  displays = [primary, secondary]
  const island = new IslandWindow(directory, true, { snapshot: async () => ({ music: { track: { title: '共享歌曲' } } }), monitor: async () => {}, music: async () => {}, notify: () => {}, setAutostart: async () => {} })
  island.supported = true; island.nativePath = () => process.execPath
  t.after(() => island.dispose())
  await island.initialize()
  await island.update({ enabled: true, displayId: '2', style: 'daozai' })
  const onSecondary = children.at(-1)
  assert.ok(onSecondary.args.includes('--yangci-position=-1280,0,1280'))
  displays = [primary]; screens.emit('display-removed')
  assert.equal(onSecondary.killed, true)
  const fallback = children.at(-1); assert.ok(fallback.args.includes('--yangci-position=0,20,1920'))
  assert.equal(island.snapshot().displayId, '2')
  displays = [primary, secondary]; screens.emit('display-added')
  assert.equal(fallback.killed, true)
  assert.ok(children.at(-1).args.includes('--yangci-position=-1280,0,1280'))
  await island.update({ enabled: true, displayId: 'all', style: 'daozai' })
  const all = [...island.natives.values()]; assert.equal(all.length, 2)
  assert.equal(all.filter(entry => entry.mirror).length, 1)
  const mirror = all.find(entry => entry.mirror).child
  assert.ok(mirror.args.includes('--yangci-mirror'))
  assert.ok(mirror.options.env.DAOZAI_DATA_DIR.startsWith(directory))
  assert.equal(await readFile(path.join(mirror.options.env.DAOZAI_DATA_DIR, 'settings.txt'), 'utf8'), 'minimal=1\n')
  assert.deepEqual(JSON.parse(await readFile(path.join(mirror.options.env.DAOZAI_DATA_DIR, 'ai-quota.json'), 'utf8')), { enabled: true, compact: false })
  let shared = ''; mirror.stdin.on('data', chunk => { shared += chunk.toString() })
  await new Promise(resolve => setImmediate(resolve))
  await island.publishNative()
  assert.match(shared, /共享歌曲/)
  const original = all.map(entry => entry.child)
  screens.emit('display-metrics-changed')
  assert.ok(original.every(child => !child.killed), 'unchanged geometry must not restart islands')
  displays = [primary]; screens.emit('display-removed')
  assert.equal(mirror.killed, true); assert.equal(island.natives.size, 1)
  const third = { id: 3, label: '第三屏', workArea: { x: 1920, y: 0, width: 1600, height: 900 } }
  displays = [primary, secondary, third]; screens.emit('display-added')
  await island.update({ enabled: true, displayId: 'multiple', displayIds: ['2', '3'], style: 'daozai' })
  assert.deepEqual([...island.natives.keys()].sort(), ['2', '3'])
  assert.deepEqual(island.snapshot().displayIds, ['2', '3'])
  displays = [primary, third]; screens.emit('display-removed')
  assert.deepEqual([...island.natives.keys()], ['3'])
  displays = [primary]; screens.emit('display-removed')
  assert.deepEqual([...island.natives.keys()], ['1'])
  displays = [primary, secondary, third]; screens.emit('display-added')
  assert.deepEqual([...island.natives.keys()].sort(), ['2', '3'])
  const restored = new IslandWindow(directory, true, { snapshot: async () => ({}), monitor: async () => {}, music: async () => {}, notify: () => {}, setAutostart: async () => {} })
  restored.supported = true; restored.nativePath = () => process.execPath
  await restored.initialize()
  assert.equal(restored.snapshot().displayId, 'multiple')
  assert.deepEqual(restored.snapshot().displayIds, ['2', '3'])
  assert.deepEqual([...restored.natives.keys()].sort(), ['2', '3'])
  restored.dispose()
  assert.throws(() => island.update({ enabled: true, displayId: 'multiple', displayIds: [], style: 'daozai' }), /至少选择/)
  assert.throws(() => island.update({ enabled: true, displayId: 'multiple', displayIds: ['2', '2'], style: 'daozai' }), /至少选择/)
  assert.throws(() => island.update({ enabled: true, displayId: 'all', style: 'pill' }), /无效/)
})

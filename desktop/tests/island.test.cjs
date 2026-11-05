const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
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
function spawnFake() {
  const child = new EventEmitter()
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
const { IslandWindow } = compiled.exports

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
  const notifications = [], startup = []
  const island = new IslandWindow(directory, true, { snapshot: async () => ({}), monitor: async () => {}, music: async () => {}, notify: (...args) => notifications.push(args), setAutostart: async enabled => startup.push(enabled) })
  island.supported = true; island.nativePath = () => process.execPath
  t.after(() => island.dispose())
  await island.initialize()
  await island.update({ enabled: true, displayId: 'primary', style: 'daozai' })
  const child = children.at(-1)
  let sent = ''; child.stdin.on('data', chunk => { sent += chunk.toString() })
  island.openNativeSettings()
  child.stdout.write(JSON.stringify({ type: 'notification', title: '提醒', body: '该休息了', sound: false }) + '\n')
  child.stdout.write(JSON.stringify({ type: 'autostart', enabled: true }) + '\n')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(sent, /"command":"open-settings"/)
  assert.deepEqual(notifications, [['提醒', '该休息了', false]])
  assert.deepEqual(startup, [true])
  await island.update({ enabled: false, displayId: 'primary', style: 'daozai' })
  assert.equal(child.killed, true)
})

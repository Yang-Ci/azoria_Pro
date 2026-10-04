const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm, writeFile, mkdir, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { transformSync, buildSync } = require('esbuild')

const filename = path.resolve(__dirname, '../src/main/touch-rotation.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
compiled._compile(transformSync(readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code, filename)
const { TouchRotationManager } = compiled.exports

test('Touch rotation advances by 90 degrees and persists', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-touch-rotation-'))
  try {
    const manager = new TouchRotationManager(directory)
    await manager.initialize()
    assert.deepEqual(manager.settings(), { degrees: 0 })
    assert.deepEqual(await manager.rotateClockwise(), { degrees: 90 })
    assert.deepEqual(await manager.rotateClockwise(), { degrees: 180 })
    assert.deepEqual(await manager.rotateClockwise(), { degrees: 270 })
    assert.deepEqual(await manager.rotateClockwise(), { degrees: 0 })

    await manager.rotateClockwise()
    const restored = new TouchRotationManager(directory)
    await restored.initialize()
    assert.deepEqual(restored.settings(), { degrees: 90 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('concurrent rotation requests each advance and persist in order', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-touch-rotation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manager = new TouchRotationManager(directory)
  await manager.initialize()
  const results = await Promise.all(Array.from({ length: 7 }, () => manager.rotateClockwise()))
  assert.deepEqual(results.map(result => result.degrees), [90, 180, 270, 0, 90, 180, 270])
  const restored = new TouchRotationManager(directory)
  await restored.initialize()
  assert.deepEqual(restored.settings(), { degrees: 270 })
})

test('a failed save leaves the angle unchanged and the next request can recover', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-touch-rotation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manager = new TouchRotationManager(directory)
  await manager.initialize()
  const blocked = path.join(directory, 'touch-rotation.json.tmp')
  await mkdir(blocked)
  await assert.rejects(manager.rotateClockwise())
  assert.deepEqual(manager.settings(), { degrees: 0 })
  await rm(blocked, { recursive: true })
  assert.deepEqual(await manager.rotateClockwise(), { degrees: 90 })
})

test('invalid stored directions use zero without replacing the original file', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-touch-rotation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const settingsPath = path.join(directory, 'touch-rotation.json')
  for (const original of ['{', 'null', JSON.stringify({ degrees: 45 }), JSON.stringify({ degrees: '90' })]) {
    await writeFile(settingsPath, original)
    const manager = new TouchRotationManager(directory)
    await manager.initialize()
    assert.deepEqual(manager.settings(), { degrees: 0 })
    assert.equal(await readFile(settingsPath, 'utf8'), original)
  }
})

function loadBundled(relative, extra = '') {
  const filename = path.resolve(__dirname, '../src', relative)
  const compiled = new Module(filename, module)
  compiled.paths = module.paths
  compiled._compile(buildSync({
    stdin: { contents: readFileSync(filename, 'utf8') + extra, loader: 'ts', resolveDir: path.dirname(filename) },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'],
  }).outputFiles[0].text, filename)
  return compiled.exports
}

test('Wi-Fi and BLE status publish the saved direction and preserve sleep settings', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-touch-rotation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manager = new TouchRotationManager(directory)
  await manager.initialize()
  const { LanController } = loadBundled('main/lan.ts')
  const { handleRequest } = loadBundled('renderer/src/ble.ts', '\nexport { handleRequest }')
  const monitor = { snapshot: () => ({ brightness: 50, volume: 20, mute: false, input: 'usbc' }), hasStatus: () => true }
  const sleep = { settings: () => ({ enabled: true, startMinutes: 1380, endMinutes: 420, active: false }) }
  const lan = new LanController('rotation-test', monitor, undefined, undefined, sleep, undefined, undefined, undefined, manager)
  lan.refreshMaster = () => 'rotation-test'
  lan.reachable = true
  t.after(() => lan.stop())
  const previousWindow = global.window
  const sign = text => require('node:crypto').createHmac('sha256', 'rotation-test').update(text).digest('hex').slice(0, 16)
  global.window = { azoria: { security: { sign: async text => sign(text) } } }
  t.after(() => { global.window = previousWindow })
  for (const degrees of [0, 90, 180, 270]) {
    if (degrees) await manager.rotateClockwise()
    let wifi
    await lan.handleHttp({ method: 'GET', url: '/v1/status', socket: { remoteAddress: '192.168.1.99' } }, {
      writeHead: status => assert.equal(status, 200), end: body => { wifi = JSON.parse(body) },
    })
    assert.equal(wifi.touchRotationDegrees, degrees)
    assert.equal(wifi.touchSleepEnabled, true)
    const status = await lan.relayStatus()
    assert.equal(status.touchRotationDegrees, degrees)
    let wire
    const unsigned = 'Q|0123456789abcdef|1234|S'
    await handleRequest(`${unsigned}|${sign(unsigned)}`, {
      writeValueWithResponse: async bytes => { wire = new TextDecoder().decode(bytes) },
    }, async () => status, async () => { throw Error('Unexpected control') }, async () => {})
    const fields = wire.split('|')
    assert.equal(fields.length, 20)
    assert.equal(fields[18], String(degrees))
    assert.deepEqual(fields.slice(14, 18), ['1', '1380', '420', '0'])
    assert.equal(fields[19], sign(fields.slice(0, -1).join('|')))
    assert.ok(Buffer.byteLength(wire) <= 244, 'Status must fit the BLE characteristic')
  }
  const legacy = new LanController('legacy', monitor)
  t.after(() => legacy.stop())
  await legacy.handleHttp({ method: 'GET', url: '/v1/status', socket: { remoteAddress: '192.168.1.99' } }, {
    writeHead: status => assert.equal(status, 200), end: body => assert.equal(JSON.parse(body).touchRotationDegrees, 0),
  })
})

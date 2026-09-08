const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const filename = path.resolve(__dirname, '../src/main/monitor.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
const { transformSync } = require('esbuild')
compiled._compile(transformSync(readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code, filename)
const { MonitorController } = compiled.exports

const fallbackProfile = {
  id: 'generic-ddc',
  name: 'Generic DDC/CI Display',
  fallback: true,
  transports: ['video-ddc'],
  ddc: {
    inputReadValues: { '17': 'hdmi1' },
    inputWriteValues: { hdmi1: '17' },
    inputWriteFeature: 'input',
  },
}

const internalPanelProfile = {
  id: 'internal-panel',
  name: 'Windows Internal Panel',
  match: { displayNamePattern: '^笔记本内屏' },
  transports: ['internal-panel'],
}

function fixture(activeDisplay = 'stable-1') {
  const monitor = new MonitorController(activeDisplay)
  monitor.profiles = [fallbackProfile]
  monitor.profileSources = new Map([['generic-ddc', 'built-in']])
  const getDisplays = []
  monitor.sidecar = async (request) => {
    if (request.operation === 'enumerate') {
      return [
        { display: 1, id: 'stable-1', driver: 'win-ddc', manufacturer: 'GSM', model: '32UQ85R' },
        { display: 2, id: 'stable-2', driver: 'win-ddc', manufacturer: 'BNQ', model: 'PD2700U' },
      ]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') {
      getDisplays.push(request.display)
      return { current: 50, maximum: 100 }
    }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }
  return { monitor, getDisplays }
}

test('display enumeration exposes stable IDs and the active target', async () => {
  const { monitor } = fixture()
  await monitor.detect(true)
  const list = await monitor.listDisplays()

  assert.equal(list.activeDisplayId, 'stable-1')
  assert.equal(list.displays.length, 2)
  assert.deepEqual(list.displays.map((display) => display.id), ['stable-1', 'stable-2'])
  assert.equal(list.displays[1].name, 'BNQ PD2700U')
  assert.equal(monitor.connectionSnapshot().displayId, 'stable-1')
})

test('selecting another display re-routes native DDC requests and resets state', async () => {
  const { monitor, getDisplays } = fixture()
  await monitor.detect(true)
  getDisplays.length = 0

  const connection = await monitor.selectDisplay('stable-2')

  assert.equal(connection.displayId, 'stable-2')
  assert.equal(connection.displayName, 'BNQ PD2700U')
  assert.equal(monitor.profile.id, 'generic-ddc')
  assert.ok(getDisplays.includes(2))
  assert.equal(monitor.connectionSnapshot().transport, 'video-ddc')
})

test('a queued command from the previous display is discarded after switching', async () => {
  const { monitor } = fixture()
  await monitor.detect(true)
  const writes = []
  monitor.write = async () => { writes.push('unexpected-write') }
  let release
  monitor.operationQueue = new Promise((resolve) => { release = resolve })

  const command = monitor.control({ control: 'brightness', value: 77, final: true }, 'touch')
  const switching = monitor.selectDisplay('stable-2')
  release()
  await Promise.all([command, switching])

  assert.deepEqual(writes, [])
  assert.equal(monitor.connectionSnapshot().displayId, 'stable-2')
})

function internalPanelFixture(system = 'windows') {
  const monitor = new MonitorController('stable-1')
  monitor.profiles = [internalPanelProfile, fallbackProfile]
  monitor.profileSources = new Map([
    ['internal-panel', 'built-in'],
    ['generic-ddc', 'built-in'],
  ])
  const internalGet = []
  const internalSet = []
  const values = { 16: 86, 98: 35, 141: 2 }
  monitor.sidecar = async (request) => {
    if (request.operation === 'enumerate') {
      return [
        { display: 1, id: 'stable-1', driver: 'win-ddc', manufacturer: null, model: null },
        { display: 2, id: 'internal-panel:AUO26A9', driver: 'wmi', model: 'AUO26A9', system, transport: 'internal-panel' },
      ]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') {
      if (request.transport !== 'internal-panel') throw new Error('DDC/CI unavailable')
      internalGet.push(request.display)
      if (!(request.vcp in values)) throw new Error('Unsupported control')
      return { current: values[request.vcp], maximum: request.vcp === 141 ? 2 : 100 }
    }
    if (request.operation === 'set') {
      if (request.transport !== 'internal-panel') throw new Error('DDC/CI unavailable')
      internalSet.push({ display: request.display, vcp: request.vcp, value: request.value })
      values[request.vcp] = request.value
      return { value: request.value, acknowledged: true }
    }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }
  return { monitor, internalGet, internalSet }
}

function numericIdFixture() {
  const monitor = new MonitorController('22799')
  monitor.profiles = [fallbackProfile]
  monitor.profileSources = new Map([['generic-ddc', 'built-in']])
  const getDisplays = []
  monitor.sidecar = async (request) => {
    if (request.operation === 'enumerate') {
      return [
        { display: 1, id: '22799', driver: 'i2c-dev', manufacturer: 'AOC', model: 'U27P10' },
        { display: 2, id: '22797', driver: 'i2c-dev', manufacturer: 'AUO', model: 'B160QAN04.U' },
      ]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') {
      getDisplays.push(request.display)
      return { current: 50, maximum: 100 }
    }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }
  return { monitor, getDisplays }
}

test('numeric stable display IDs are selected as IDs rather than list indexes', async () => {
  const { monitor, getDisplays } = numericIdFixture()
  await monitor.detect(true)
  getDisplays.length = 0

  const connection = await monitor.selectDisplay('22797')

  assert.equal(connection.displayId, '22797')
  assert.equal(connection.displayName, 'AUO B160QAN04.U')
  assert.ok(getDisplays.includes(2))
  assert.ok(!getDisplays.includes(22797))
})

test('Windows internal panels stay independent until the internal target is selected', async () => {
  const { monitor, internalGet } = internalPanelFixture()
  await monitor.detect(true)
  let info = monitor.wizardInfo()

  assert.equal(info.activeDisplayId, 'stable-1')
  assert.equal(info.activeTransport, 'unavailable')
  assert.equal(info.displays[1].transport, 'internal-panel')

  const status = await monitor.control({ control: 'input', value: 'internal', final: true })
  info = monitor.wizardInfo()

  assert.equal(info.activeDisplayId, 'internal-panel:AUO26A9')
  assert.equal(info.displayName, '笔记本内屏 AUO26A9')
  assert.deepEqual(info.availableTransports, ['internal-panel'])
  assert.equal(info.activeTransport, 'internal-panel')
  assert.equal(info.displays[1].transport, 'internal-panel')
  assert.equal(info.displays[1].system, 'windows')
  assert.equal(monitor.connectionSnapshot().summary, 'Windows 笔记本内屏')
  assert.equal(status.input, 'internal')
  assert.ok(internalGet.includes(2))
})

test('Linux internal panels report the system-backed route', async () => {
  const { monitor } = internalPanelFixture('linux')
  await monitor.detect(true)
  await monitor.control({ control: 'input', value: 'internal', final: true })

  const list = await monitor.listDisplays()

  assert.equal(list.displays[1].system, 'linux')
  assert.equal(monitor.connectionSnapshot().summary, 'Linux 笔记本内屏')
})

test('Windows internal panels route brightness, system volume and mute with readback', async () => {
  const { monitor, internalSet } = internalPanelFixture()
  await monitor.detect(true)
  assert.equal((await monitor.control({ control: 'input', value: 'internal', final: true })).input, 'internal')

  const status = await monitor.control({ control: 'brightness', value: 80, final: true })
  assert.equal(status.brightness, 80)
  assert.deepEqual(internalSet, [{ display: 2, vcp: 16, value: 80 }])

  assert.equal((await monitor.status()).volume, 35)
  assert.equal((await monitor.control({ control: 'volume', value: 20, final: true })).volume, 20)
  assert.equal((await monitor.control({ control: 'mute', value: true, final: true })).mute, true)
  assert.equal((await monitor.control({ control: 'mute', value: false, final: true })).mute, false)
  assert.deepEqual(internalSet.slice(1), [
    { display: 2, vcp: 98, value: 20 },
    { display: 2, vcp: 141, value: 1 },
    { display: 2, vcp: 141, value: 2 },
  ])
  await assert.rejects(
    () => monitor.control({ control: 'input', value: 'hdmi1', final: true }),
    /外接显示器控制不可用/,
  )
})

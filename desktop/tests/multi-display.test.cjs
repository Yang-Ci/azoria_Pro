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
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')

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

test('sleeping outputs suspend passive DDC reads and discovery until manual restore', async () => {
  const { monitor } = fixture()
  await monitor.detect(true)
  await monitor.status()
  const saved = monitor.snapshot()
  const originalSidecar = monitor.sidecar
  let requests = 0
  monitor.sidecar = async request => { requests++; return originalSidecar(request) }
  monitor.setExternalPowerOff(true)
  monitor.startBackgroundStatus(5, 10)
  try {
    assert.deepEqual(await monitor.status(), saved)
    await monitor.readFastStatus()
    await monitor.connection(true)
    await monitor.listDisplays()
    await monitor.refreshInputDetectionNow()
    assert.equal(await monitor.reachable(), true)
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.equal(requests, 0, 'Background polling and UI refreshes must not probe sleeping outputs')
    monitor.setExternalPowerOff(false)
    await monitor.status()
    assert.ok(requests > 0, 'Hardware polling resumes after restore')
  } finally { clearInterval(monitor.backgroundTimer) }
})

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

test('startup does not wait for input capability probing', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-input-deferred-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'generic.json'), readFileSync(path.resolve(__dirname, '../profiles/generic-ddc.json')))

  let releaseInput
  let signalInputStarted
  const inputStarted = new Promise(resolve => { signalInputStarted = resolve })
  const inputGate = new Promise(resolve => { releaseInput = resolve })
  const monitor = new MonitorController('stable-1', directory, directory)
  monitor.sidecar = async request => {
    if (request.operation === 'enumerate') {
      return [{ display: 1, id: 'stable-1', manufacturer: 'GSM', model: '32UQ85R' }]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') return { current: 50, maximum: 100 }
    if (request.operation === 'input_info') {
      signalInputStarted()
      await inputGate
      return { supported: false }
    }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }

  const initialized = monitor.initialize()
  let timeout
  const bounded = Promise.race([
    initialized,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('startup blocked on input probing')), 100)
    }),
  ])
  try {
    await bounded
    await inputStarted
    assert.equal(monitor.connectionSnapshot().transport, 'video-ddc')
  } finally {
    clearTimeout(timeout)
    releaseInput()
  }
  await initialized
})

test('startup uses cached display topology without waiting for enumeration', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-display-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'generic.json'), readFileSync(path.resolve(__dirname, '../profiles/generic-ddc.json')))
  const cachedDisplay = { id: 'stable-1', index: 1, name: 'GSM 32UQ85R', manufacturer: 'GSM', model: '32UQ85R', connector: 'DP-1' }
  await writeFile(path.join(directory, 'display-topology.cache'), JSON.stringify({ version: 1, displays: [cachedDisplay] }))

  let releaseEnumerate
  let signalEnumerateStarted
  const enumerateStarted = new Promise(resolve => { signalEnumerateStarted = resolve })
  const enumerateGate = new Promise(resolve => { releaseEnumerate = resolve })
  const monitor = new MonitorController('stable-1', directory, directory)
  monitor.sidecar = async request => {
    if (request.operation === 'enumerate') {
      signalEnumerateStarted()
      await enumerateGate
      return [{ display: 1, id: 'stable-1', manufacturer: 'GSM', model: '32UQ85R', connector: 'DP-1' }]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') return { current: 50, maximum: 100 }
    if (request.operation === 'input_info') return { supported: false }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }

  let timeout
  const initialized = monitor.initialize()
  const bounded = Promise.race([
    initialized,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('startup blocked on display enumeration')), 100)
    }),
  ])
  try {
    await bounded
    assert.equal(monitor.connectionSnapshot().transport, 'video-ddc')
    await enumerateStarted
  } finally {
    clearTimeout(timeout)
    releaseEnumerate()
  }
  await initialized
  await monitor.displayTopologyRefresh
})

test('a stale cached display falls back to full enumeration', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-display-cache-stale-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'generic.json'), readFileSync(path.resolve(__dirname, '../profiles/generic-ddc.json')))
  await writeFile(path.join(directory, 'display-topology.cache'), JSON.stringify({
    version: 1,
    displays: [{ id: 'gone', index: 1, name: 'Disconnected screen' }],
  }))

  const monitor = new MonitorController('gone', directory, directory)
  monitor.sidecar = async request => {
    if (request.operation === 'enumerate') {
      return [{ display: 1, id: 'stable-1', manufacturer: 'GSM', model: '32UQ85R' }]
    }
    if (request.operation === 'probe') throw new Error('No USB HID display')
    if (request.operation === 'get') {
      if (request.display_id === 'gone') throw new Error('display ID gone was not found')
      return { current: 50, maximum: 100 }
    }
    if (request.operation === 'input_info') return { supported: false }
    throw new Error(`Unexpected sidecar operation: ${request.operation}`)
  }

  await monitor.initialize()
  assert.equal(monitor.connectionSnapshot().displayId, 'stable-1')
  assert.equal(monitor.connectionSnapshot().transport, 'video-ddc')
  await monitor.displayTopologyRefresh
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

test('linked controllers reuse discovery and previews but refresh topology on expiry', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-linked-controllers-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'generic.json'), readFileSync(path.resolve(__dirname, '../profiles/generic-ddc.json')))
  const original = MonitorController.prototype.sidecar
  t.after(() => { MonitorController.prototype.sidecar = original })
  let connected = true, index = 1, brightness = 50
  const operations = []
  MonitorController.prototype.sidecar = async request => {
    operations.push(request)
    if (request.operation === 'enumerate') return connected
      ? Array.from({ length: index }, (_, position) => ({ display: position + 1, id: position + 1 === index ? 'stable-1' : 'other', model: 'test' }))
      : [{ display: 1, id: 'other', model: 'test' }]
    if (request.operation === 'get') return { current: brightness, maximum: 100 }
    if (request.operation === 'set') { brightness = request.value; return {} }
    throw new Error('Unexpected linked discovery')
  }
  const monitor = new MonitorController('stable-1', directory, directory)
  const controller = await monitor.forDisplay('stable-1')
  await controller.control({ control: 'brightness', value: 63, final: false }, 'touch')
  const discoveries = operations.filter(item => item.operation === 'enumerate').length
  const reads = operations.filter(item => item.operation === 'get').length
  assert.equal(await monitor.forDisplay('stable-1'), controller)
  await controller.control({ control: 'brightness', value: 63, final: true }, 'touch')
  assert.equal(operations.filter(item => item.operation === 'enumerate').length, discoveries)
  assert.equal(operations.filter(item => item.operation === 'get').length, reads + 1)
  assert.equal(operations.filter(item => item.operation === 'set').length, 1)
  monitor.profiles = controller.profiles
  await monitor.detect(true)
  await controller.control({ control: 'brightness', value: 64, final: false }, 'touch')
  await monitor.control({ control: 'brightness', value: 80, final: true }, 'touch')
  await controller.control({ control: 'brightness', value: 64, final: true }, 'touch')
  assert.equal(brightness, 64)
  assert.deepEqual(operations.filter(item => item.operation === 'set').slice(-3).map(item => item.value), [64, 80, 64])
  index = 2
  monitor.displays = await monitor.enumerateDisplays()
  monitor.brightnessControllers.get('stable-1').expiresAt = 0
  assert.equal(await monitor.forDisplay('stable-1'), controller)
  await controller.control({ control: 'brightness', value: 65, final: true }, 'touch')
  assert.equal(operations.filter(item => item.operation === 'set').at(-1).display, 2)
  connected = false
  monitor.displays = await monitor.enumerateDisplays()
  monitor.brightnessControllers.get('stable-1').expiresAt = 0
  await assert.rejects(monitor.forDisplay('stable-1'), /断开/)
  assert.equal(monitor.brightnessControllers.has('stable-1'), false)
})

function automaticTargetFixture() {
  const monitor = new MonitorController('desktop')
  monitor.profiles = [internalPanelProfile, { ...fallbackProfile, ddc: {
    inputReadValues: { '15': 'dp1', '17': 'hdmi1', '18': 'hdmi2', '27': 'usbc' },
    inputWriteValues: { dp1: '15', hdmi1: '17', hdmi2: '18', usbc: '27' },
    inputWriteFeature: 'input',
  } }]
  let connected = true, reversed = false, desktopInput = 18
  const brightness = { desktop: 50, portable: 78, panel: 50 }
  const writes = []
  monitor.sidecar = async request => {
    const screens = [
      { id: 'desktop', manufacturer: 'XYZ', model: 'Office Screen', connector: 'HDMI-A-1' },
      ...(connected ? [{ id: 'portable', manufacturer: 'QRS', model: 'Type_C', connector: 'DP-2' }] : []),
      { id: 'panel', model: 'Internal', transport: 'internal-panel', system: 'linux' },
    ]
    if (reversed) screens.reverse()
    if (request.operation === 'enumerate') return screens.map((display, index) => ({ ...display, display: index + 1 }))
    if (request.operation === 'probe') throw new Error('No HID')
    const id = request.display_id || screens[request.display - 1]?.id
    if (request.operation === 'input_info') return id === 'desktop'
      ? { supported: true, values: [15, 17, 18], current: desktopInput }
      : { supported: false, values: [], current: 17 } // Broken panel returns brightness even for input.
    if (request.operation === 'get') return { current: request.vcp === 96 ? (id === 'desktop' ? desktopInput : 17)
      : request.vcp === 141 ? 2 : brightness[id], maximum: 100 }
    if (request.operation === 'set') {
      writes.push({ id, vcp: request.vcp, value: request.value })
      if (request.vcp === 96 && id === 'desktop') desktopInput = request.value
      if (request.vcp === 16) brightness[id] = request.value
      return {}
    }
    throw new Error('Unexpected operation')
  }
  return { monitor, writes, disconnect: () => { connected = false }, reverse: () => { reversed = true } }
}

test('shortcuts automatically select the connected USB-C display without writing its input', async () => {
  const { monitor, writes } = automaticTargetFixture()
  await monitor.detect(true)
  const state = monitor.controlState()
  assert.equal(state.targets.find(target => target.input === 'usbc').displayId, 'portable')
  assert.equal(state.targets.find(target => target.input === 'dp1').displayId, 'desktop')
  const status = await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  assert.equal(monitor.connectionSnapshot().displayId, 'portable')
  assert.equal(status.input, 'usbc')
  assert.equal(status.brightness, 78)
  assert.deepEqual(writes, [])
  assert.equal((await monitor.status()).input, 'usbc')
  assert.equal((await monitor.status()).brightness, 78)
  await monitor.control({ control: 'brightness', value: 42 }, 'touch')
  assert.equal(writes[0].id, 'portable')
})

test('DP and HDMI shortcuts return to the screen advertising those inputs', async () => {
  const { monitor, writes } = automaticTargetFixture()
  await monitor.detect(true)
  await monitor.control({ control: 'input', value: 'usbc' }, 'desktop-ui')
  await monitor.control({ control: 'input', value: 'dp1' }, 'touch')
  assert.equal(monitor.connectionSnapshot().displayId, 'desktop')
  assert.deepEqual(writes, [{ id: 'desktop', vcp: 96, value: 15 }])
  await monitor.control({ control: 'input', value: 'hdmi2' }, 'touch')
  assert.deepEqual(writes.at(-1), { id: 'desktop', vcp: 96, value: 18 })
})

test('disconnected USB-C targets do not fall through to another monitor', async () => {
  const { monitor, writes, disconnect } = automaticTargetFixture()
  await monitor.detect(true)
  disconnect()
  await assert.rejects(monitor.control({ control: 'input', value: 'usbc' }), /匹配的显示器/)
  assert.deepEqual(writes, [])
})

test('automatic routing survives enumeration reordering and an internal-panel selection', async () => {
  const { monitor, writes, reverse } = automaticTargetFixture()
  await monitor.detect(true)
  await monitor.control({ control: 'input', value: 'internal' })
  reverse()
  await monitor.control({ control: 'input', value: 'usbc' })
  assert.equal(monitor.connectionSnapshot().displayId, 'portable')
  await monitor.control({ control: 'input', value: 'hdmi1' })
  assert.deepEqual(writes, [{ id: 'desktop', vcp: 96, value: 17 }])
})

test('queued shortcut changes execute in order without discarding the second target', async () => {
  const { monitor, writes } = automaticTargetFixture()
  await monitor.detect(true)
  await Promise.all([
    monitor.control({ control: 'input', value: 'usbc' }, 'touch'),
    monitor.control({ control: 'input', value: 'dp1' }, 'touch'),
  ])
  assert.equal(monitor.connectionSnapshot().displayId, 'desktop')
  assert.deepEqual(writes, [{ id: 'desktop', vcp: 96, value: 15 }])
})

test('recent Touch targets reuse verified routes and values without another probe or status sweep', async () => {
  const { monitor, writes } = automaticTargetFixture()
  await monitor.detect(true)
  await monitor.status()
  await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  await monitor.control({ control: 'input', value: 'internal' }, 'touch')
  const sidecar = monitor.sidecar
  const operations = []
  monitor.sidecar = async request => {
    operations.push(request.operation)
    if (['get', 'probe', 'input_info'].includes(request.operation)) throw new Error('Unexpected foreground read')
    return sidecar(request)
  }
  const portable = await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  assert.equal(portable.input, 'usbc')
  assert.equal(portable.brightness, 78)
  assert.deepEqual(operations, ['enumerate'])
  operations.length = 0
  await monitor.control({ control: 'input', value: 'dp1' }, 'touch')
  assert.deepEqual(operations, ['enumerate', 'set'])
  assert.deepEqual(writes, [{ id: 'desktop', vcp: 96, value: 15 }])
})

test('an expired Touch target cache detects and refreshes the display again', async () => {
  const { monitor } = automaticTargetFixture()
  await monitor.detect(true)
  await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  await monitor.control({ control: 'input', value: 'internal' }, 'touch')
  monitor.displayControlCache.get('portable').at = 0
  const sidecar = monitor.sidecar
  const operations = []
  monitor.sidecar = async request => { operations.push(request.operation); return sidecar(request) }
  assert.equal((await monitor.control({ control: 'input', value: 'usbc' }, 'touch')).brightness, 78)
  assert.ok(operations.includes('probe'))
  assert.ok(operations.includes('get'))
})

test('a cached Touch target still detects connector changes and rejects a disconnected display', async () => {
  const { monitor, disconnect, writes } = automaticTargetFixture()
  await monitor.detect(true)
  await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  await monitor.control({ control: 'input', value: 'internal' }, 'touch')
  const sidecar = monitor.sidecar
  let probes = 0
  monitor.sidecar = async request => {
    if (request.operation === 'probe') probes++
    const result = await sidecar(request)
    if (request.operation === 'enumerate') result.find(display => display.id === 'portable').connector = 'DP-3'
    return result
  }
  await monitor.control({ control: 'input', value: 'usbc' }, 'touch')
  assert.ok(probes > 0)
  await monitor.control({ control: 'input', value: 'internal' }, 'touch')
  monitor.sidecar = sidecar
  disconnect()
  await assert.rejects(monitor.control({ control: 'input', value: 'usbc' }, 'touch'), /匹配的显示器/)
  assert.deepEqual(writes, [])
})

test('duplicate input matches require an explicit dropdown choice', async () => {
  const { monitor } = automaticTargetFixture()
  await monitor.detect(true)
  monitor.displays.push({ id: 'portable-2', index: 4, name: 'Other screen' })
  monitor.inputDetection.set('portable-2', { current: 'usbc', supported: [], selectOnly: true })
  assert.equal(monitor.controlState().targets.find(target => target.input === 'usbc').action, 'unavailable')
  monitor.display = 'portable-2'
  assert.equal(monitor.controlState().targets.find(target => target.input === 'usbc').displayId, 'portable-2')
})

test('kernel Type-C association works with any monitor name', async () => {
  const { monitor } = automaticTargetFixture()
  const original = monitor.sidecar
  monitor.sidecar = async request => {
    const result = await original(request)
    if (request.operation === 'enumerate') {
      const portable = result.find(display => display.id === 'portable')
      portable.model = 'Any display name'
      portable.connection_type = 'usbc'
    }
    return result
  }
  await monitor.detect(true)
  assert.equal(monitor.controlState().targets.find(target => target.input === 'usbc').displayId, 'portable')
})

test('external power discovery skips hard-off-only panels and built-in screens', async () => {
  const monitor = new MonitorController()
  monitor.enumerateDisplays = async () => [
    { id: 'hard-off', index: 1, name: 'Panel A', transport: 'video-ddc' },
    { id: 'standby', index: 2, name: 'Panel B', transport: 'video-ddc' },
    { id: 'builtin', index: 3, name: 'Laptop', transport: 'internal-panel' },
  ]
  const requests = []
  monitor.sidecarValue = async request => { requests.push(request); return { supported: true, current: 1, values: request.display === 1 ? [1, 5] : [1, 2, 4, 5] } }
  assert.deepEqual(await monitor.displayPowerTargets(), [{ id: 'standby', index: 2, name: 'Panel B', originalValue: 1, offValue: 2 }])
  assert.equal(requests.length, 2)
})

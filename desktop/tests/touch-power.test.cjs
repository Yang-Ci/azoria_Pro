const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { buildSync } = require('esbuild')

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
const { touchBluetoothStatus } = loadBundled('shared/touch-power.ts')
const data = {
  available: true, batteryLevel: 100, batteryStatus: 'full', mode: 'balanced', sampledAt: 1, error: null,
  devices: [{ name: '罗技 MX Master 3S', level: 86 }, { name: '键盘', level: null }, { name: '耳机', level: 0 }],
}

test('Touch device selection retains unknown and zero levels and clamps after disconnects', () => {
  assert.equal(touchBluetoothStatus(data).bluetoothName, '罗技 MX Master 3S')
  assert.equal(touchBluetoothStatus(data, 1).bluetoothLevel, -1)
  assert.equal(touchBluetoothStatus(data, 2).bluetoothLevel, 0)
  assert.equal(touchBluetoothStatus(data, 10).bluetoothIndex, 2)
  assert.deepEqual(touchBluetoothStatus({ ...data, available: false }), {
    bluetoothAvailable: false, bluetoothCount: 0, bluetoothIndex: 0, bluetoothName: '', bluetoothLevel: -1,
  })
  assert.equal(touchBluetoothStatus({ ...data, devices: [] }).bluetoothCount, 0)
})

test('Touch device names are bounded UTF-8 and cannot break flat JSON or BLE fields', () => {
  const current = touchBluetoothStatus({ ...data, devices: [{ name: '中文"\\|\n' + '耳机'.repeat(100), level: 34 }] })
  assert.ok(Buffer.byteLength(current.bluetoothName) <= 60)
  assert.doesNotMatch(current.bluetoothName, /["\\|\r\n\ufffd]/)
  assert.equal(current.bluetoothCount, 1)
})

test('LAN power endpoint publishes the selected device and rejects invalid indices', async t => {
  const { LanController } = loadBundled('main/lan.ts')
  const power = { snapshot: () => ({ supported: true, off: false, externalCount: 2 }) }
  const lan = new LanController('power-test', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, power, { collect: async () => data })
  t.after(() => lan.stop())
  const get = async url => {
    let status, value
    await lan.handleHttp({ method: 'GET', url, socket: { remoteAddress: '192.168.1.99' } }, {
      writeHead: code => { status = code }, end: body => { value = JSON.parse(body) },
    })
    return { status, value }
  }
  const selected = await get('/v1/power/status?device=1')
  assert.equal(selected.status, 200)
  assert.equal(selected.value.bluetoothName, '键盘')
  assert.equal(selected.value.bluetoothLevel, -1)
  assert.equal(selected.value.dataAvailable, true)
  assert.equal(selected.value.batteryLevel, 100)
  assert.equal((await get('/v1/power/status')).value.bluetoothName, '罗技 MX Master 3S')
  for (const index of ['-1', '255', '1.5', 'abc']) assert.equal((await get('/v1/power/status?device=' + index)).status, 400)
  assert.equal((await get('/v1/power/status-other')).status, 404)
})

test('BLE power replies support selected devices within the characteristic and preserve legacy status', async t => {
  const { handleRequest } = loadBundled('renderer/src/ble.ts', '\nexport { handleRequest }')
  const previousWindow = global.window
  const sign = text => require('node:crypto').createHmac('sha256', 'power-test').update(text).digest('hex').slice(0, 16)
  let current = data
  global.window = { azoria: {
    security: { sign: async text => sign(text) },
    power: { externalState: async () => ({ supported: true, off: false, externalCount: 2, linked: true, busy: false }), data: async () => current },
    touchSleep: { settings: async () => ({ enabled: true, startMinutes: 1421, endMinutes: 702 }) },
  } }
  t.after(() => { global.window = previousWindow })
  const get = async action => {
    const unsigned = 'Q|0123456789abcdef|4294967295|W|' + action
    let wire
    await handleRequest(unsigned + '|' + sign(unsigned), {
      writeValueWithResponse: async bytes => { wire = new TextDecoder().decode(bytes) },
    }, async () => { throw Error('Unexpected status') }, async () => { throw Error('Unexpected control') }, async () => {})
    assert.ok(Buffer.byteLength(wire) <= 244, 'Power reply must fit the BLE characteristic')
    const fields = wire.split('|')
    assert.equal(fields.at(-1), sign(fields.slice(0, -1).join('|')))
    return fields
  }
  const legacy = await get('status')
  assert.equal(legacy.length, 16)
  for (const index of [0, 1, 2]) {
    const fields = await get('status-' + index)
    assert.equal(fields.length, 21)
    assert.equal(fields[15], '1')
    assert.equal(fields[16], '3')
    assert.equal(fields[17], String(index))
    assert.equal(fields[18], data.devices[index].name)
    assert.equal(fields[19], String(data.devices[index].level ?? -1))
  }
  assert.equal((await get('status-255'))[3], 'E')
  current = { ...data, devices: Array.from({ length: 255 }, () => ({ name: '蓝牙设备'.repeat(100), level: 100 })) }
  const largest = await get('status-254')
  assert.equal(largest[16], '255')
  assert.equal(largest[17], '254')
  assert.ok(Buffer.byteLength(largest[18]) <= 60)
})

test('linked Touch backlight uses the same resolved state over LAN and legacy BLE status', async t => {
  const { LanController } = loadBundled('main/lan.ts')
  const { handleRequest } = loadBundled('renderer/src/ble.ts', '\nexport { handleRequest }')
  let awake = true
  const screens = () => ({ supported: true, off: true, externalCount: 2, linked: false, busy: false, touchBacklight: { awake, sleepAt: null, wakeAt: null } })
  const legacy = { enabled: true, startMinutes: 500, endMinutes: 501, weekdays: [0,1,2,3,4,5,6], resumeDate: null, active: false }
  const lan = new LanController('touch-follow-test', { snapshot: () => ({ brightness: 50, volume: 20, input: 'usbc', mute: false }), hasStatus: () => true }, undefined, undefined, { settings: () => legacy }, undefined, undefined, undefined, undefined, { snapshot: screens, touchStatus: () => ({}) })
  const before = global.window
  const sign = value => require('node:crypto').createHmac('sha256', 'follow-test').update(value).digest('hex').slice(0,16)
  global.window = { azoria: { security: { sign: async value => sign(value) }, power: { externalState: async () => screens(), data: async () => data }, touchSleep: { settings: async () => legacy } } }
  t.after(() => { global.window = before; lan.stop() })
  for (const value of [true,false,true]) {
    awake = value
    let wifi
    await lan.handleHttp({method:'GET',url:'/v1/status',socket:{remoteAddress:'192.168.1.99'}},{writeHead: code => assert.equal(code,200),end: body => {wifi=JSON.parse(body)}})
    assert.equal(wifi.touchSleepEnabled,!awake)
    assert.equal(wifi.touchSleepActive,!awake)
    let ble
    const unsigned='Q|0123456789abcdef|55|W|status'
    await handleRequest(unsigned+'|'+sign(unsigned), {writeValueWithResponse:async bytes=>{ble=new TextDecoder().decode(bytes)}}, async()=>{},async()=>{},async()=>{})
    assert.equal(ble.split('|')[12],awake?'0':'1')
    assert.ok(Buffer.byteLength(ble)<=244)
  }
})

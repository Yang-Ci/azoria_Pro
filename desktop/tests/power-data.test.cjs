const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformSync } = require('esbuild')
function fixture(battery, mode = 'balanced', failure = false) {
  const filename = path.resolve(__dirname, '../src/main/power-data.ts'), compiled = new Module(filename, module)
  compiled.paths = module.paths
  const calls = []
  const execFile = () => {}
  execFile[require('node:util').promisify.custom] = async file => {
    calls.push(file)
    if (file === '/usr/bin/python3' && failure) throw Error('UPower unavailable')
    return { stdout: file === '/usr/bin/python3' ? JSON.stringify(battery) : mode, stderr: '' }
  }
  compiled.require = name => name === 'node:child_process' ? { execFile } : require(name)
  compiled._compile(transformSync(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code, filename)
  return { service: new compiled.exports.PowerDataService(), calls }
}
test('power data uses system values, keeps unavailable Bluetooth battery null, and deduplicates requests', async () => {
  const { service, calls } = fixture({ batteryLevel: 87.4, batteryStatus: 'discharging', devices: [{ name: 'Mouse', level: null }] }, 'power-saver')
  const [first, second] = await Promise.all([service.collect(), service.collect()])
  assert.deepEqual(first, second); assert.equal(first.batteryLevel, 87); assert.equal(first.batteryStatus, 'discharging'); assert.equal(first.mode, 'power-saver')
  assert.deepEqual(first.devices, [{ name: 'Mouse', level: null }])
  first.devices[0].level = 80
  assert.equal((await service.collect()).devices[0].level, null)
  assert.equal(calls.length, 2)
})
test('unavailable system services clear stale or fabricated power readings', async () => {
  const { service } = fixture({}, 'performance', true)
  const result = await service.collect()
  assert.equal(result.available, false); assert.equal(result.batteryLevel, null); assert.deepEqual(result.devices, []); assert.match(result.error, /读取失败/)
})
test('out-of-range battery readings and unsupported modes remain unknown', async () => {
  const { service } = fixture({ batteryLevel: 155, batteryStatus: 'bad', devices: [{ name: 'Keyboard', level: -2 }] }, 'unsupported')
  const result = await service.collect()
  assert.equal(result.batteryLevel, null); assert.equal(result.batteryStatus, 'unknown'); assert.equal(result.mode, 'unknown'); assert.equal(result.devices[0].level, null)
})

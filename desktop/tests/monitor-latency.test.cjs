const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

// Exercise the real controller with a simulated DDC adapter, without Electron
// or access to a physical display.
const filename = path.resolve(__dirname, '../src/main/monitor.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
const { transformSync } = require('esbuild')
compiled._compile(transformSync(readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code, filename)
const { MonitorController } = compiled.exports

function fixture() {
  const monitor = new MonitorController()
  monitor.profile = { id: 'test', transports: ['video-ddc'] }
  monitor.available = new Set(['video-ddc'])
  monitor.transport = 'video-ddc'
  const writes = []
  const reads = []
  let brightness = 50
  monitor.write = async (control, value) => { writes.push(value); brightness = value }
  monitor.read = async (control) => { reads.push(control); return brightness }
  monitor.detect = async () => { throw new Error('Unexpected foreground discovery') }
  return { monitor, writes, reads }
}

test('release reuses an identical successful preview but still verifies the value', async () => {
  const { monitor, writes, reads } = fixture()
  await monitor.control({ control: 'brightness', value: 63, final: false }, 'touch')
  await monitor.control({ control: 'brightness', value: 63, final: true }, 'touch')
  assert.deepEqual(writes, [63])
  assert.deepEqual(reads, ['brightness'])
  assert.equal(monitor.snapshot().brightness, 63)
})

test('a different final value is written and verified', async () => {
  const { monitor, writes, reads } = fixture()
  await monitor.control({ control: 'brightness', value: 84, final: false }, 'touch')
  await monitor.control({ control: 'brightness', value: 63, final: true }, 'touch')
  assert.deepEqual(writes, [84, 63])
  assert.deepEqual(reads, ['brightness'])
})

test('queued previews collapse to the latest final command', async () => {
  const { monitor, writes } = fixture()
  let release
  monitor.operationQueue = new Promise(resolve => { release = resolve })
  const requests = [10, 20, 30, 40].map((value, index) => monitor.control({
    control: 'brightness', value, final: index === 3,
  }, 'touch'))
  release()
  await Promise.all(requests)
  assert.deepEqual(writes, [40])
  assert.equal(monitor.pendingControls, 0)
})

test('a failed preview cannot suppress the final write', async () => {
  const { monitor, writes } = fixture()
  const write = monitor.write
  monitor.write = async () => { throw new Error('DDC disconnected') }
  await assert.rejects(monitor.control({ control: 'brightness', value: 63, final: false }), /disconnected/)
  monitor.write = write
  await monitor.control({ control: 'brightness', value: 63, final: true })
  assert.deepEqual(writes, [63])
})

test('recent DDC success satisfies reachability without another read', async () => {
  const { monitor, reads } = fixture()
  await monitor.control({ control: 'brightness', value: 63, final: false })
  assert.equal(await monitor.reachable(), true)
  assert.deepEqual(reads, [])
})

test('background status yields between controls when user input arrives', async () => {
  const { monitor, reads, writes } = fixture()
  let request
  monitor.readStable = async (control) => {
    reads.push(control)
    request = monitor.control({ control: 'brightness', value: 63, final: false })
    return 50
  }
  await monitor.status()
  await request
  assert.deepEqual(reads, ['brightness'])
  assert.deepEqual(writes, [63])
})

test('a readback mismatch remains an error', async () => {
  const { monitor } = fixture()
  monitor.read = async () => 10
  await assert.rejects(monitor.control({ control: 'brightness', value: 63 }), /回读值/)
})

test('background stability confirmation yields before its second DDC read', async () => {
  const { monitor, reads } = fixture()
  monitor.lastStatus.brightness = 40
  monitor.read = async (control) => {
    reads.push(control)
    monitor.pendingControls = 1
    return 50
  }
  assert.equal(await monitor.readStable('brightness'), 40)
  assert.deepEqual(reads, ['brightness'])
})

test('queued final input commands collapse to the latest choice', async () => {
  const { monitor, writes } = fixture()
  let release
  monitor.operationQueue = new Promise(resolve => { release = resolve })
  const requests = ['dp1', 'hdmi1', 'dp1', 'hdmi2'].map(value => monitor.control({ control: 'input', value }, 'touch'))
  release()
  await Promise.all(requests)
  assert.deepEqual(writes, ['hdmi2'])
  assert.equal(monitor.snapshot().input, 'hdmi2')
  assert.equal(monitor.pendingControls, 0)
})

test('an in-flight input write completes before the latest queued input', async () => {
  const { monitor, writes } = fixture()
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const writing = new Promise(resolve => { started = resolve })
  monitor.write = async (_control, value) => {
    writes.push(value)
    if (writes.length === 1) { started(); await gate }
  }
  const first = monitor.control({ control: 'input', value: 'dp1' })
  await writing
  const obsolete = monitor.control({ control: 'input', value: 'hdmi1' })
  const last = monitor.control({ control: 'input', value: 'hdmi2' })
  release()
  await Promise.all([first, obsolete, last])
  assert.deepEqual(writes, ['dp1', 'hdmi2'])
})

test('input settling suppresses background DDC reads without delaying a new switch', async () => {
  const { monitor, writes, reads } = fixture()
  await monitor.control({ control: 'input', value: 'hdmi2' })
  await monitor.status()
  await monitor.readFastStatus()
  assert.deepEqual(reads, [])
  await monitor.control({ control: 'input', value: 'dp1' })
  assert.deepEqual(writes, ['hdmi2', 'dp1'])
})

test('a user command aborts a slow background capability query before writing', async () => {
  const { monitor, writes } = fixture()
  monitor.displays = [{ id: 'screen', index: 1, name: 'Screen' }]
  // Keep this test focused on yielding the queue rather than target routing.
  monitor.ensureInputTopology = async () => {}
  let started
  const probing = new Promise(resolve => { started = resolve })
  let aborted = false
  monitor.sidecar = async (request, signal) => {
    assert.equal(request.operation, 'input_info')
    started()
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      aborted = true
      reject(new Error('Aborted passive probe'))
    }, { once: true }))
  }
  const background = monitor.enqueue(() => monitor.refreshInputDetection(true))
  await probing
  const control = monitor.control({ control: 'brightness', value: 63, final: false })
  await Promise.all([background, control])
  assert.equal(aborted, true)
  assert.deepEqual(writes, [63])
  assert.equal(monitor.inputDetection.has('screen'), false, 'An aborted read must not poison the capability cache')
})

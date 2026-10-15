const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const filename = path.resolve(__dirname, '../src/main/display-power.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
compiled._compile(esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, filename)
const { DisplayPowerManager } = compiled.exports

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'yangci-display-power-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const layout = { monitors: [{ connector: 'eDP-1', builtin: true }, { connector: 'HDMI-1', builtin: false }, { connector: 'DP-2', builtin: false }], groups: ['eDP-1', 'HDMI-1', 'DP-2'].map(connector => ({ x: 0, y: 0, scale: 1, transform: 0, primary: connector === 'eDP-1', monitors: [{ connector, mode: '1920x1080' }] })), layoutMode: 2 }
  if (options.noInternal) layout.monitors.shift()
  const calls = []
  let current = structuredClone(layout)
  let changed
  const backend = { capture: async () => structuredClone(current), isolate: async saved => { calls.push(['isolate', saved]); if (options.failOff) throw Error('Display configuration failed'); current.groups = saved.groups.filter(group => group.monitors.every(monitor => monitor.connector === 'eDP-1')) }, restore: async saved => { calls.push(['restore', saved]); if (options.failRestore) throw Error('Restore failed'); current = structuredClone(saved) }, watchChanges: callback => { changed = callback; return () => { changed = undefined } } }
  const target = { id: 'external', index: 2, name: 'External', originalValue: 1, offValue: 4 }
  const monitor = { displayPowerTargets: async () => [target], setDisplayPower: async (display, value) => { calls.push(['ddc', display.id, value]) }, coordinateBrightness: async work => work() }
  let enabled = false
  const sleep = { settings: now => ({ enabled, startMinutes: 23 * 60, endMinutes: 7 * 60, active: enabled && (now.getHours() >= 23 || now.getHours() < 7) }) }
  const manager = new DisplayPowerManager(directory, sleep, monitor, backend)
  await manager.initialize()
  return { manager, calls, layout, target, options, enable: () => { enabled = true }, directory, sleep, monitor, backend, reconnect: () => { current = structuredClone(layout); changed?.() } }
}

test('one click powers down only external DDC targets and isolates the OS outputs; restore reuses saved layout', async t => {
  const { manager, calls, layout } = await fixture(t)
  const off = await manager.control('off')
  assert.equal(off.off, true); assert.equal(off.externalCount, 2); assert.equal(off.busy, false)
  assert.deepEqual(calls[0], ['ddc', 'external', 4]); assert.deepEqual(calls[1], ['isolate', layout])
  await manager.control('off')
  assert.equal(calls.length, 2, 'retries must not repeat hardware operations')
  assert.equal((await manager.control('on')).off, false)
  assert.deepEqual(calls[2], ['ddc', 'external', 1]); assert.deepEqual(calls[3], ['restore', layout])
})

test('without an internal panel, no external monitor is powered off', async t => {
  const { manager, calls } = await fixture(t, { noInternal: true })
  await assert.rejects(manager.control('off'), /没有可用的笔记本内屏/)
  assert.deepEqual(calls, []); assert.equal(manager.snapshot().off, false)
})

test('failed isolation rolls power and layout back and keeps the persisted state on', async t => {
  const { manager, calls, directory } = await fixture(t, { failOff: true })
  await assert.rejects(manager.control('off'), /Display configuration failed/)
  assert.equal(manager.snapshot().off, false)
  assert.deepEqual(calls.map(call => call[0]), ['ddc', 'isolate', 'ddc', 'restore'])
  assert.equal(JSON.parse(await readFile(path.join(directory, 'external-display-power.json'))).off, false)
})

test('a failed restore retains its recovery layout so the user can retry', async t => {
  const f = await fixture(t)
  await f.manager.control('off'); f.options.failRestore = true
  await assert.rejects(f.manager.control('on'), /Restore failed/)
  assert.equal(f.manager.snapshot().off, true)
  const saved = JSON.parse(await readFile(path.join(f.directory, 'external-display-power.json')))
  assert.deepEqual(saved.layout, f.layout)
  f.options.failRestore = false
  assert.equal((await f.manager.control('on')).off, false)
})

test('an incomplete rollback keeps the recovery snapshot and enables another restore', async t => {
  const f = await fixture(t, { failOff: true, failRestore: true })
  await assert.rejects(f.manager.control('off'), /恢复布局已保留/)
  assert.equal(f.manager.snapshot().off, true)
  f.options.failRestore = false
  assert.equal((await f.manager.control('on')).off, false)
})

test('cross-midnight Touch sleep turns off and restores automatically; manual wake lasts through the current interval', async t => {
  const f = await fixture(t); f.enable()
  await f.manager.control('link-on', new Date(2026, 9, 14, 22, 59))
  assert.equal((await f.manager.sync(new Date(2026, 9, 14, 23, 0))).off, true)
  assert.equal((await f.manager.sync(new Date(2026, 9, 15, 6, 59))).off, true)
  assert.equal((await f.manager.sync(new Date(2026, 9, 15, 7, 0))).off, false)
  await f.manager.sync(new Date(2026, 9, 15, 23, 0))
  await f.manager.control('on', new Date(2026, 9, 16, 1, 0))
  assert.equal((await f.manager.sync(new Date(2026, 9, 16, 3, 0))).off, false)
  assert.equal((await f.manager.sync(new Date(2026, 9, 16, 23, 0))).off, true)
})

test('disabling schedule linkage restores scheduled sleep but preserves manual sleep', async t => {
  const f = await fixture(t); f.enable(); const now = new Date(2026, 9, 14, 23, 1)
  await f.manager.control('link-on', now); assert.equal(f.manager.snapshot().off, true)
  await f.manager.control('link-off', now); assert.equal(f.manager.snapshot().off, false)
  await f.manager.control('off', now); await f.manager.control('link-off', now)
  assert.equal(f.manager.snapshot().off, true)
})

test('a restarted desktop can still restore the external display layout', async t => {
  const f = await fixture(t); await f.manager.control('off')
  const restored = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend)
  await restored.initialize(); assert.equal(restored.snapshot().off, true)
  assert.equal((await restored.control('on')).off, false)
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
})

test('startup reuses the initial display-layout capture', async t => {
  const f = await fixture(t)
  const originalCapture = f.backend.capture
  let captures = 0
  f.backend.capture = async () => {
    captures++
    return originalCapture()
  }
  const restarted = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend)
  await restarted.initialize()

  assert.equal(captures, 1)
  assert.equal(restarted.snapshot().externalCount, 2)
})

test('DDC wake failure still restores desktop outputs and retains recovery for retry', async t => {
  const f = await fixture(t)
  await f.manager.control('off')
  f.monitor.setDisplayPower = async () => { throw Error('DDC unreachable') }
  await assert.rejects(f.manager.control('on'), /显示输出已恢复/)
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
  assert.equal(f.manager.snapshot().off, true)
  f.monitor.setDisplayPower = async () => {}
  assert.equal((await f.manager.control('on')).off, false)
})

test('manual sleep repairs re-enabled outputs without repeating DDC or losing the original layout', async t => {
  const f = await fixture(t)
  await f.manager.control('off')
  const saved = await readFile(path.join(f.directory, 'external-display-power.json'), 'utf8')
  await f.manager.sync(); assert.equal(f.calls.length, 2, 'healthy sleeping outputs must not be reconfigured')
  f.reconnect()
  assert.equal((await f.manager.sync()).off, true)
  assert.deepEqual(f.calls.map(call => call[0]), ['ddc', 'isolate', 'isolate'])
  assert.equal(await readFile(path.join(f.directory, 'external-display-power.json'), 'utf8'), saved)
  await f.manager.sync(); assert.equal(f.calls.length, 3)
  await f.manager.control('on')
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
})

test('monitor change events maintain sleep, stop after restore, and unsubscribe on shutdown', async t => {
  const f = await fixture(t)
  f.manager.start(); t.after(() => f.manager.stop())
  await f.manager.control('off')
  f.reconnect(); f.reconnect()
  await f.manager.topologySync
  assert.deepEqual(f.calls.map(call => call[0]), ['ddc', 'isolate', 'isolate'])
  await f.manager.control('on')
  f.reconnect(); assert.equal(f.manager.topologySync, undefined)
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
  f.manager.stop()
  await f.manager.control('off')
  f.reconnect(); assert.equal(f.manager.topologySync, undefined)
})

test('startup repairs an externally restored layout while preserving the saved recovery layout', async t => {
  const f = await fixture(t)
  await f.manager.control('off'); f.reconnect()
  const restarted = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend)
  await restarted.initialize()
  assert.equal(restarted.snapshot().off, true)
  assert.deepEqual(f.calls.map(call => call[0]), ['ddc', 'isolate', 'isolate'])
  await restarted.control('on')
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
})

test('a failed repair keeps recovery information and allows a later restore', async t => {
  const f = await fixture(t)
  await f.manager.control('off'); f.reconnect(); f.options.failOff = true
  await assert.rejects(f.manager.sync(), /Display configuration failed/)
  assert.equal(f.manager.snapshot().off, true)
  assert.match(f.manager.snapshot().error, /Display configuration failed/)
  f.options.failOff = false
  await f.manager.control('on')
  assert.deepEqual(f.calls.at(-1), ['restore', f.layout])
})

test('power transitions suspend monitor polling and a successful rollback resumes it', async t => {
  const f = await fixture(t)
  const polling = []
  f.monitor.setExternalPowerOff = off => polling.push(off)
  await f.manager.control('off')
  assert.deepEqual(polling, [true])
  await f.manager.control('on')
  assert.deepEqual(polling, [true, false])
  f.options.failOff = true
  await assert.rejects(f.manager.control('off'), /Display configuration failed/)
  assert.deepEqual(polling, [true, false, true, false])
})

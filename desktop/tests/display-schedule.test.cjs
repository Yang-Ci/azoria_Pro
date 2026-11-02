const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm, readFile } = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
function load(relative, extra = '') {
  const filename = path.resolve(__dirname, '../src', relative), compiled = new Module(filename, module)
  compiled.paths = module.paths
  compiled._compile(buildSync({ stdin: { contents: readFileSync(filename, 'utf8') + extra, loader: 'ts', resolveDir: path.dirname(filename) }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] }).outputFiles[0].text, filename)
  return compiled.exports
}
const { defaultDisplaySchedule, displayScheduleOn, nextDisplayChange, validateDisplaySchedule, updateDisplaySchedule } = load('shared/display-schedule.ts')
const { DisplayPowerManager } = load('main/display-power.ts')
const at = (day, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute)
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-weekly-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const layout = { monitors: [{ connector: 'eDP-1', builtin: true }, { connector: 'HDMI-1', builtin: false }, { connector: 'DP-2', builtin: false }], groups: ['eDP-1', 'HDMI-1', 'DP-2'].map(connector => ({ monitors: [{ connector, mode: 'test' }] })), layoutMode: 2 }
  let actual = structuredClone(layout), failOff = false, idle = 7200
  const calls = []
  const backend = { capture: async () => structuredClone(actual), isolate: async () => { if (failOff) throw Error('isolate failed'); calls.push('off'); actual.groups = layout.groups.slice(0, 1) }, restore: async () => { calls.push('on'); actual = structuredClone(layout) } }
  const monitor = { displayPowerTargets: async () => [{ id: 'a', originalValue: 1, offValue: 4 }], setDisplayPower: async (_, v) => calls.push(v), coordinateBrightness: work => work() }
  const sleep = { settings: () => ({ active: false }) }
  const power = new DisplayPowerManager(directory, sleep, monitor, backend, async () => idle)
  await power.initialize()
  return { power, calls, directory, backend, monitor, sleep, setIdle: value => { idle = value }, reconnect: () => { actual = structuredClone(layout) }, fail: () => { failOff = true } }
}

test('all minutes in an office week, exact boundaries and Friday through Monday', () => {
  const plan = defaultDisplaySchedule()
  for (let minute = 0; minute < 10080; minute++) {
    const now = at(19, 0, minute), m = now.getHours() * 60 + now.getMinutes()
    assert.equal(displayScheduleOn(plan, now), now.getDay() > 0 && now.getDay() < 6 && m >= 530 && m < 1090)
  }
  assert.equal(+nextDisplayChange(plan, at(23, 18, 10)), +at(26, 8, 50))
  assert.equal(+nextDisplayChange(plan, at(19, 8, 50)), +at(19, 18, 10))
})

test('multiple periods, midnight, adjacent intervals, all-on/off and next week', () => {
  const plan = defaultDisplaySchedule()
  plan.week = Array.from({ length: 7 }, () => [])
  assert.equal(nextDisplayChange(plan, at(19)), null)
  plan.week = Array.from({ length: 7 }, () => [{ startMinutes: 0, endMinutes: 1440 }])
  assert.equal(nextDisplayChange(plan, at(19)), null)
  plan.week[1] = [{ startMinutes: 0, endMinutes: 600 }, { startMinutes: 600, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1440 }]
  assert.equal(+nextDisplayChange(plan, at(19, 9)), +at(19, 12))
  assert.equal(displayScheduleOn(plan, at(19, 12)), false)
  assert.equal(displayScheduleOn(plan, at(19, 13)), true)
  assert.equal(+nextDisplayChange(plan, at(19, 13)), +at(26, 12))
})

test('invalid/overlapping ranges and stale writes are rejected without mutating the plan', () => {
  const current = defaultDisplaySchedule(), original = structuredClone(current)
  for (const periods of [[{ startMinutes: 600, endMinutes: 600 }], [{ startMinutes: -1, endMinutes: 2 }], [{ startMinutes: 0, endMinutes: 1441 }], [{ startMinutes: 0, endMinutes: 20 }, { startMinutes: 19, endMinutes: 30 }], Array(9).fill({ startMinutes: 1, endMinutes: 2 })]) {
    assert.throws(() => updateDisplaySchedule(current, { revision: 0, day: 1, periods }, at(19)))
  }
  assert.throws(() => updateDisplaySchedule(current, { revision: 1, enabled: true }, at(19)), /其他设备/)
  assert.deepEqual(current, original)
  assert.throws(() => validateDisplaySchedule({ ...current, week: [] }))
})

test('two external outputs stay off throughout the weekend, restore Monday, and recover after restart', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true }, at(23, 18, 9))
  assert.equal((await f.power.sync(at(23, 18, 10))).off, true)
  for (const day of [24, 25]) for (const hour of [0, 8, 9, 12, 18, 23]) assert.equal((await f.power.sync(at(day, hour))).off, true)
  f.reconnect(); await f.power.sync(at(25, 12))
  assert.equal(f.calls.filter(v => v === 'off').length, 2, 'hotplug reapplies isolation')
  const restored = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend)
  // Avoid using wall clock in this restart simulation.
  const saved = JSON.parse(await readFile(path.join(f.directory, 'external-display-power.json')))
  restored.state = saved; restored.supported = true
  assert.equal((await restored.sync(at(26, 8, 49))).off, true)
  assert.equal((await restored.sync(at(26, 8, 50))).off, false)
  assert.equal(f.calls.filter(v => v === 'on').length, 1)
})

test('Touch and desktop manual commands hold to next actual boundary, for a duration or indefinitely', async t => {
  const { power } = await fixture(t)
  await power.updateSchedule({ revision: 0, enabled: true }, at(23, 19))
  await power.control('on', at(24, 12))
  assert.equal(power.snapshot(at(24, 12)).override.until, +at(26, 8, 50))
  assert.equal((await power.sync(at(25, 12))).off, false)
  assert.equal((await power.sync(at(26, 8, 50))).override, null)
  await power.control('off', at(26, 9), 30)
  assert.equal((await power.sync(at(26, 9, 29))).off, true)
  assert.equal((await power.sync(at(26, 9, 30))).off, false)
  await power.control('off', at(26, 10), -1)
  assert.equal((await power.sync(at(27, 10))).off, true)
  assert.equal((await power.control('auto', at(27, 10))).off, false)
})

test('vacation pauses weekly power-off and ends at local midnight; validation preserves saved state', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true }, at(23, 19))
  assert.equal((await f.power.updateSchedule({ revision: 1, resumeDate: '2026-10-26' }, at(23, 19))).off, false)
  assert.equal((await f.power.sync(at(25, 23, 59))).off, false)
  assert.equal((await f.power.sync(at(26))).off, true)
  await assert.rejects(f.power.updateSchedule({ revision: 2, resumeDate: '2026-02-30' }, at(23)), /无效/)
  assert.equal(f.power.snapshot().schedule.revision, 2)
  await assert.rejects(f.power.updateSchedule({ revision: 1, enabled: false }, at(23)), /其他设备/)
  const state = f.power.snapshot(); state.schedule.week[1].length = 0
  assert.equal(f.power.snapshot().schedule.week[1].length, 1)
})

const follow = { activityDelayMinutes: 10, touchFollow: true, touchWakeLeadMinutes: 10, touchSleepDelayMinutes: 10 }

test('only the last minute matters, with fixed ten-minute decisions and a ten-minute Touch grace', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(19, 17))
  f.setIdle(59.999)
  let state = await f.power.sync(at(19, 18, 10))
  assert.equal(state.off, false)
  assert.equal(state.activityLookbackSeconds, 60)
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 20))
  assert.equal(state.touchBacklight.awake, true)
  f.setIdle(600)
  state = await f.power.sync(at(19, 18, 18))
  assert.equal(state.off, false, 'inactivity must not end the promised delay early')
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 20))
  f.setIdle(0)
  state = await f.power.sync(at(19, 18, 19))
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 20), 'input between decisions cannot slide the deadline')
  f.setIdle(20)
  state = await f.power.sync(at(19, 18, 20))
  assert.equal(state.off, false)
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 30))
  f.setIdle(60)
  const offAt = at(19, 18, 30)
  state = await f.power.sync(offAt)
  assert.equal(state.off, true, 'one full minute without input is sufficient; ten minutes is not required')
  assert.equal(state.deferredUntil, null)
  assert.equal(+new Date(state.touchBacklight.sleepAt), +offAt + 600000)
  assert.equal(state.touchBacklight.awake, true)
  f.setIdle(0)
  assert.equal((await f.power.sync(new Date(+offAt + 599999))).touchBacklight.awake, true)
  state = await f.power.sync(new Date(+offAt + 600000))
  assert.equal(state.touchBacklight.awake, false)
  assert.equal(state.off, true, 'new input cannot undo a completed shutdown')
})

test('input older than one minute does not postpone the first scheduled shutdown', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(19, 17))
  f.setIdle(61)
  const state = await f.power.sync(at(19, 18, 10))
  assert.equal(state.off, true)
  assert.equal(state.deferredUntil, null)
  assert.equal(+new Date(state.touchBacklight.sleepAt), +at(19, 18, 20))
})

test('a postponed decision survives restart, but manual off cancels it immediately', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(19, 17))
  f.setIdle(0)
  await f.power.sync(at(19, 18, 10))
  const saved = JSON.parse(await readFile(path.join(f.directory, 'external-display-power.json')))
  assert.deepEqual(saved.automaticOffCheck, { periodEnd: +at(19, 18, 10), at: +at(19, 18, 20) })
  let reads = 0
  const restored = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend, async () => { reads++; return 120 })
  restored.state = saved; restored.supported = true
  let state = await restored.sync(at(19, 18, 15))
  assert.equal(state.off, false)
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 20))
  assert.equal(reads, 0, 'no activity sampling between scheduled decisions')
  state = await restored.sync(at(19, 18, 20))
  assert.equal(state.off, true)
  assert.equal(reads, 1)
  await restored.control('on', at(19, 18, 21), 1)
  // The manual hold expires at 18:22, and recent input postpones to 18:32.
  restored.idleSeconds = async () => 0
  state = await restored.sync(at(19, 18, 22))
  assert.equal(+new Date(state.deferredUntil), +at(19, 18, 32))
  state = await restored.control('off', at(19, 18, 23))
  assert.equal(state.off, true)
  assert.equal(state.deferredUntil, null)
  assert.equal(+new Date(state.touchBacklight.sleepAt), +at(19, 18, 33))
  assert.equal(JSON.parse(await readFile(path.join(f.directory, 'external-display-power.json'))).automaticOffCheck, null)
})

test('postponements expire on the next on period, a new off period, or a full off day', async t => {
  const f = await fixture(t)
  const week = defaultDisplaySchedule().week
  week[1] = [{ startMinutes: 530, endMinutes: 720 }, { startMinutes: 725, endMinutes: 1090 }]
  await f.power.updateSchedule({ revision: 0, enabled: true, week, ...follow }, at(19, 11))
  f.setIdle(0)
  assert.equal(+new Date((await f.power.sync(at(19, 12))).deferredUntil), +at(19, 12, 10))
  assert.equal((await f.power.sync(at(19, 12, 5))).deferredUntil, null, 'new on period cancels previous delay')
  f.setIdle(61)
  assert.equal((await f.power.sync(at(19, 18, 10))).off, true)
  await f.power.control('on', at(23, 18), 1)
  await f.power.sync(at(23, 18, 1))
  f.setIdle(0)
  assert.equal((await f.power.sync(at(23, 18, 10))).off, false)
  assert.equal((await f.power.sync(at(24))).off, true, 'Friday delay cannot keep weekend screens on')
})

test('manual early-off wins over recent input and the countdown survives sync and restart', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(23, 17))
  f.setIdle(0)
  let state = await f.power.control('off', at(23, 17, 30))
  assert.equal(state.off, true)
  assert.equal(+new Date(state.touchBacklight.sleepAt), +at(23, 17, 40))
  await f.power.control('off', at(23, 17, 35))
  state = await f.power.sync(at(23, 17, 40))
  assert.equal(state.touchBacklight.awake, false, 'duplicate off must not restart the grace period')
  const saved = JSON.parse(await readFile(path.join(f.directory, 'external-display-power.json')))
  assert.equal(saved.offSince, +at(23, 17, 30))
  const restored = new DisplayPowerManager(f.directory, f.sleep, f.monitor, f.backend)
  restored.state = saved; restored.supported = true
  assert.equal((await restored.sync(at(23, 18, 10))).off, true)
  assert.equal(restored.snapshot(at(24, 12)).touchBacklight.awake, false)
  assert.equal(restored.snapshot(at(25, 12)).touchBacklight.awake, false)
  assert.equal(restored.snapshot(new Date(+at(26, 8, 40) - 1)).touchBacklight.awake, false)
  assert.equal(restored.snapshot(at(26, 8, 40)).touchBacklight.awake, true)
  assert.equal((await restored.sync(at(26, 8, 49))).off, true)
  assert.equal(restored.snapshot(at(26, 8, 50)).touchBacklight.awake, true, 'Touch must remain on while the scheduled output wake is pending')
  state = await restored.sync(at(26, 8, 50))
  assert.equal(state.off, false)
  assert.equal(state.touchBacklight.awake, true)
})

test('unavailable activity data keeps screens on; weekends and manual off remain effective', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(23, 17))
  f.setIdle(null)
  let state = await f.power.sync(at(23, 18, 10))
  assert.equal(state.off, false)
  assert.equal(state.activityAvailable, false)
  state = await f.power.sync(at(24))
  assert.equal(state.off, true, 'a full off day is never extended by activity')
  await f.power.control('on', at(24, 12))
  assert.equal((await f.power.control('off', at(24, 12, 1))).off, true)
})

test('a manual restore after hours grants ten minutes then returns to activity-aware sleep', async t => {
  const f = await fixture(t)
  await f.power.updateSchedule({ revision: 0, enabled: true, ...follow }, at(19, 17))
  f.setIdle(600)
  await f.power.sync(at(19, 18, 10))
  let state = await f.power.control('on', at(19, 18, 15))
  assert.equal(state.override.until, +at(19, 18, 25))
  f.setIdle(0)
  state = await f.power.sync(at(19, 18, 25))
  assert.equal(state.off, false)
  assert.equal(state.override, null)
  f.setIdle(600)
  assert.equal((await f.power.sync(at(19, 18, 35))).off, true)
})

test('linked backlight keeps old firmware wire windows active, including midnight and late Sunday', () => {
  const { touchBacklightWire } = load('shared/touch-backlight.ts')
  for (const now of [at(19), at(19, 23, 58), at(19, 23, 59), at(25, 12)]) {
    const wire = touchBacklightWire({ awake: false }, now)
    const m = now.getHours() * 60 + now.getMinutes()
    const start = wire.touchSleepStartMinutes, end = wire.touchSleepEndMinutes
    const active = wire.touchSleepEnabled && (start < end ? m >= start && m < end : m >= start || m < end)
    assert.equal(active, true)
    const nextMinute = (m + 1) % 1440
    assert.equal(start < end ? nextMinute >= start && nextMinute < end : nextMinute >= start || nextMinute < end, true, 'a late heartbeat must not flash the backlight at midnight')
    assert.equal(touchBacklightWire({ awake: true }, now).touchSleepEnabled, false)
  }
  assert.deepEqual(touchBacklightWire(undefined), {})
})

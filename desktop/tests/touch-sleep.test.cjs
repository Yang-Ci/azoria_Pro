const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, rm, writeFile, mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { buildSync } = require('esbuild')
function load(relative, extra = '') {
  const filename = path.resolve(__dirname, '../src', relative)
  const compiled = new Module(filename, module); compiled.paths = module.paths
  compiled._compile(buildSync({ stdin: { contents: readFileSync(filename, 'utf8') + extra, loader: 'ts', resolveDir: path.dirname(filename) }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] }).outputFiles[0].text, filename)
  return compiled.exports
}
const { TouchSleepManager } = load('main/touch-sleep.ts')
const { isTouchSleepActive, touchSleepDeviceEnabled, allSleepWeekdays } = load('shared/touch-sleep.ts')
const plan = { enabled: true, startMinutes: 23 * 60, endMinutes: 7 * 60, weekdays: [1, 2, 3, 4, 5], resumeDate: null }
const at = (day, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute)
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'azoria-sleep-days-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manager = new TouchSleepManager(directory); await manager.initialize()
  return { directory, manager }
}

test('overnight schedules belong to the start day, including Friday into Saturday and Sunday into Monday', () => {
  for (const [time, expected] of [[at(16,22,59),false],[at(16,23),true],[at(17,6,59),true],[at(17,7),false],[at(17,23),false],[at(18,6),false],[at(19,6),false],[at(19,23),true]]) {
    assert.equal(isTouchSleepActive(plan,time),expected,time.toString())
  }
  assert.equal(isTouchSleepActive({...plan,weekdays:[0]},at(19,6)),true)
  assert.equal(isTouchSleepActive({...plan,weekdays:[0]},at(19,7)),false)
  assert.equal(isTouchSleepActive({...plan,weekdays:[6]},at(17,6)),false)
  assert.equal(isTouchSleepActive({...plan,weekdays:[6]},at(18,6)),true)
})

test('daytime windows honor weekdays and exclusive end times', () => {
  const settings = {...plan,startMinutes:9*60,endMinutes:18*60}
  for (const [time,expected] of [[at(16,8,59),false],[at(16,9),true],[at(16,17,59),true],[at(16,18),false],[at(17,12),false]]) assert.equal(isTouchSleepActive(settings,time),expected)
  assert.equal(isTouchSleepActive({...settings,enabled:false},at(16,12)),false)
})

test('holiday pause ends at local midnight and early cancellation preserves the plan', async t => {
  const { manager } = await fixture(t)
  await manager.update({...plan,weekdays:[...allSleepWeekdays],resumeDate:'2026-10-19'},at(14,12))
  assert.equal(manager.settings(at(18,23,59)).active,false)
  assert.equal(manager.settings(at(19,0)).active,true)
  assert.equal(manager.settings(at(19,0)).resumeDate,null)
  await manager.update({...plan,resumeDate:'2026-10-19'},at(14,12))
  const resumed=await manager.update({...plan,resumeDate:null},at(16,23))
  assert.equal(resumed.active,true)
  assert.deepEqual(resumed.weekdays,plan.weekdays)
})

test('legacy configuration retains daily behavior; schedules and pause dates persist independently', async t => {
  const { manager,directory }=await fixture(t)
  await writeFile(path.join(directory,'touch-sleep.json'),JSON.stringify({enabled:true,startMinutes:1380,endMinutes:420}))
  await manager.initialize()
  assert.deepEqual(manager.settings(at(17,23)).weekdays,allSleepWeekdays)
  assert.equal(manager.settings(at(17,23)).active,true)
  await manager.update({...plan,resumeDate:'2026-10-19'},at(14))
  const restored=new TouchSleepManager(directory);await restored.initialize()
  assert.deepEqual(restored.settings(at(14)).weekdays,plan.weekdays)
  assert.equal(restored.settings(at(14)).resumeDate,'2026-10-19')
  // An older renderer saving only times cannot silently discard the new fields.
  await restored.update({enabled:true,startMinutes:1320,endMinutes:420},at(14))
  assert.deepEqual(restored.settings(at(14)).weekdays,plan.weekdays)
  assert.equal(restored.settings(at(14)).resumeDate,'2026-10-19')
  const returned=restored.settings(at(14));returned.weekdays.length=0
  assert.deepEqual(restored.settings(at(14)).weekdays,plan.weekdays)
})

test('invalid dates/days and failed writes preserve the last saved schedule', async t => {
  const { manager,directory }=await fixture(t)
  await manager.update(plan,at(14))
  for (const weekdays of [[],[1,1],[-1],[7],['1'],null]) await assert.rejects(manager.update({...plan,weekdays},at(14)),/星期|选择/)
  for (const resumeDate of ['2026-02-30','2026-13-01','2026-10-14','2026-10-13','not-a-date']) await assert.rejects(manager.update({...plan,resumeDate},at(14,12)),/日期/)
  assert.deepEqual(manager.settings(at(14)).weekdays,plan.weekdays)
  await mkdir(path.join(directory,'touch-sleep.json.tmp'))
  await assert.rejects(manager.update({...plan,weekdays:[6]},at(14)))
  assert.deepEqual(manager.settings(at(14)).weekdays,plan.weekdays)
})

test('old Touch time-window logic is gated correctly by weekday and vacation over Wi-Fi and BLE', async t => {
  const { manager }=await fixture(t)
  await manager.update(plan,at(14))
  const { LanController }=load('main/lan.ts')
  const { handleRequest }=load('renderer/src/ble.ts','\nexport { handleRequest }')
  const RealDate=Date;let now=at(17,12).getTime()
  global.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now]))} static now(){return now} }
  const oldWindow=global.window
  const sign=text=>require('node:crypto').createHmac('sha256','sleep-test').update(text).digest('hex').slice(0,16)
  global.window={azoria:{security:{sign:async text=>sign(text)}}}
  t.after(()=>{global.Date=RealDate;global.window=oldWindow})
  const lan=new LanController('sleep-test',{snapshot:()=>({brightness:50,volume:20,mute:false,input:'usbc'}),hasStatus:()=>true},undefined,undefined,manager)
  lan.refreshMaster=()=> 'sleep-test';lan.reachable=true;t.after(()=>lan.stop())
  for(const [day,hour,enabled] of [[17,6,true],[17,12,false],[18,23,false],[19,6,false],[19,23,true]]) {
    now=at(day,hour).getTime();let wifi
    await lan.handleHttp({method:'GET',url:'/v1/status',socket:{remoteAddress:'192.168.1.9'}},{writeHead:code=>assert.equal(code,200),end:body=>{wifi=JSON.parse(body)}})
    assert.equal(wifi.touchSleepEnabled,enabled)
    assert.equal(wifi.touchSleepActive,isTouchSleepActive(plan,new Date()))
    let reply;const unsigned='Q|0123456789abcdef|1|S'
    await handleRequest(unsigned+'|'+sign(unsigned),{writeValueWithResponse:async bytes=>{reply=new TextDecoder().decode(bytes)}},()=>lan.relayStatus(),async()=>{},async()=>{})
    assert.equal(reply.split('|')[14],enabled?'1':'0');assert.equal(reply.split('|').length,20)
    assert.ok(Buffer.byteLength(reply)<=244)
  }
  now=at(14,23).getTime()
  await manager.update({...plan,resumeDate:'2026-10-19'},at(14,12))
  assert.equal(touchSleepDeviceEnabled(manager.settings(),new Date()),false)
  assert.equal((await lan.relayStatus()).touchSleepEnabled,false)
})

test('linked external screens restore on excluded days or holiday pause while manual sleep is preserved', async t => {
  const { directory,manager:sleep }=await fixture(t)
  const { DisplayPowerManager }=load('main/display-power.ts')
  const layout={monitors:[{connector:'eDP-1',builtin:true},{connector:'HDMI-1',builtin:false}],groups:[{monitors:[{connector:'eDP-1',mode:'internal'}]}],layoutMode:2}
  const calls=[]
  const power=new DisplayPowerManager(directory,sleep,{displayPowerTargets:async()=>[],coordinateBrightness:async work=>work()},
    {capture:async()=>layout,isolate:async()=>calls.push('off'),restore:async()=>calls.push('on')})
  await power.initialize()
  await sleep.update({...plan,weekdays:[5]},at(14))
  await power.control('link-on',at(16,23))
  assert.equal(power.snapshot(at(16,23)).off,true)
  assert.equal((await power.sync(at(17,6))).off,true)
  assert.equal((await power.sync(at(17,7))).off,false)
  assert.equal((await power.sync(at(17,23))).off,false)
  await sleep.update({...plan,weekdays:allSleepWeekdays},at(14))
  assert.equal((await power.sync(at(16,23))).off,true)
  await sleep.update({...plan,weekdays:allSleepWeekdays,resumeDate:'2026-10-19'},at(16,23))
  assert.equal((await power.sync(at(16,23))).off,false)
  await power.control('off',at(16,23))
  assert.equal((await power.sync(at(16,23))).off,true,'Vacation must not undo manual power-off')
  await power.control('on',at(16,23))
  assert.equal((await power.sync(at(16,23))).off,false)
  assert.deepEqual(calls.slice(0,4),['off','on','off','on'])
})

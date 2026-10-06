const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const filename = path.resolve(__dirname, '../src/main/lan.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
compiled._compile(buildSync({
  entryPoints: [filename], bundle: true, write: false, platform: 'node',
  format: 'cjs', external: ['electron'],
}).outputFiles[0].text, filename)
const { LanController } = compiled.exports

function fixture(t) {
  const desktopId = 'a'.repeat(32)
  const writes = [], packets = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const monitor = {
    reachable: async () => true,
    control: async request => {
      writes.push(request)
      await gate
      return { brightness: request.value }
    },
  }
  const lan = new LanController(desktopId, monitor)
  t.after(() => lan.stop())
  lan.peers.set(desktopId, { id: desktopId, address: '192.168.1.2', reachable: true, master: true, seenAt: Date.now() })
  lan.masterId = desktopId
  const socket = { send: (wire, port, address) => packets.push({ wire: wire.toString(), port, address }) }
  const network = { address: '192.168.1.2', netmask: '255.255.255.0', broadcast: '192.168.1.255' }
  const remote = { address: '192.168.1.3', port: 8733 }
  const command = Buffer.from('AZORIA_TOUCH_COMMAND_V1|68F6578FEE68|1234abcd|42|brightness|73|1')
  const deliver = () => lan.handleCoordination(socket, network, command, remote)
  return { lan, desktopId, writes, packets, release, deliver }
}

test('broadcast, unicast and retries of one Touch command produce one monitor write', async t => {
  const f = fixture(t)
  await f.deliver()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 1)
  // A unicast copy can arrive before the broadcast's DDC transaction completes.
  await f.deliver()
  assert.equal(f.writes.length, 1)
  f.release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.lan.inflightCommands.size, 0)
  const confirmed = f.packets.find(packet => packet.port === 8733)
  assert.equal(confirmed.address, '192.168.1.3')
  assert.ok(confirmed.wire.endsWith('|1|1|brightness|73'))
  await f.deliver()
  assert.equal(f.writes.length, 1)
  assert.deepEqual(f.packets.at(-1), confirmed)
})

test('a unicast copy sent to a non-master cannot execute the Touch command', async t => {
  const f = fixture(t)
  const master = 'b'.repeat(32)
  f.lan.peers.set(master, { id: master, address: '192.168.1.4', reachable: true, master: true, seenAt: Date.now() })
  f.lan.peers.get(f.desktopId).master = false
  f.lan.masterId = master
  const consume = f.lan.consumeCommand.bind(f.lan)
  let completion
  f.lan.consumeCommand = (...args) => { completion = consume(...args); return completion }
  await f.deliver()
  await completion
  assert.deepEqual(f.writes, [])
  assert.equal(f.lan.inflightCommands.size, 0)
})

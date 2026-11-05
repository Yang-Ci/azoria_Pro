const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

let responses = []
class FakePort extends EventEmitter {
  constructor() { super(); this.isOpen = false }
  open(callback) { this.isOpen = true; callback() }
  write(_command, callback) {
    callback()
    for (const [delay, data] of responses) setTimeout(() => this.emit('data', Buffer.from(data)), delay)
  }
  close(callback) { this.isOpen = false; callback() }
}

const filename = path.resolve(__dirname, '../src/main/touch.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
const originalRequire = compiled.require.bind(compiled)
compiled.require = (name) => name === 'serialport' ? { SerialPort: FakePort } : originalRequire(name)
compiled._compile(buildSync({ entryPoints: [filename], bundle: true, write: false,
  platform: 'node', packages: 'external', format: 'cjs', target: 'node20' }).outputFiles[0].text, filename)
const { TouchManager } = compiled.exports

test('waits for a complete error line when USB splits a response across chunks', async () => {
  responses = [[0, 'AZORIA_ERROR'], [5, ' Wi-Fi connection failed; check the password\n']]
  const manager = new TouchManager('test-token')
  await assert.rejects(manager.exchange('COM8', 'test\n', 'AZORIA_OK', 100), /检查名称、密码和 2\.4 GHz 信号/)
})

test('accepts a complete saved response split across USB chunks', async () => {
  responses = [[0, 'AZORIA_WIFI_OK ip=192.168.3.8\nAZORIA_'], [5, 'OK configuration saved\n']]
  const manager = new TouchManager('test-token')
  assert.match(await manager.exchange('COM8', 'test\n', 'AZORIA_OK', 100), /configuration saved/)
})

test('reports a configuration timeout as an unconfirmed result', async () => {
  const manager = new TouchManager('test-token')
  manager.assertDevice = async () => {}
  manager.exchange = async () => { throw new Error('小屏幕 USB 响应超时') }
  await assert.rejects(manager.configureWifi('COM8', 'network', 'password'), /配网结果未确认/)
})

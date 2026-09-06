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

const lgProfile = {
  id: 'lg-32uq85r',
  name: 'LG 32UQ85R',
  match: { displayNamePattern: 'LG.*32UQ85' },
  transports: ['video-ddc'],
  ddc: {
    inputReadValues: { '17': 'hdmi1' },
    inputWriteValues: { hdmi1: '17' },
    inputWriteFeature: 'input',
  },
}

const usbProfile = {
  id: 'usb-display',
  name: 'USB Display',
  match: { usbHid: { vendorId: 1086, productId: 39481 } },
  transports: ['usb-hid-ddc'],
  usbHid: {
    adapter: 'lg-monitor-controls-v1',
    vcp: { brightness: 16, volume: 98, mute: 141, input: 96 },
    inputWriteMode: 'vcp',
    inputReadValues: { '17': 'hdmi1' },
    inputWriteValues: { hdmi1: 17 },
  },
}

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

function fixture() {
  const monitor = new MonitorController()
  monitor.profiles = [lgProfile, usbProfile, fallbackProfile]
  monitor.profileSources = new Map([
    ['lg-32uq85r', 'built-in'],
    ['usb-display', 'built-in'],
    ['generic-ddc', 'built-in'],
  ])
  return monitor
}

async function detectWith(monitor, { name, hid, video }) {
  monitor.detectDisplayName = async () => name
  monitor.probeHidDdc = async () => hid
  monitor.probeVideoDdc = async () => video
  await monitor.detect(true)
}

test('the wizard auto-matches a display-name profile', async () => {
  const monitor = fixture()
  await detectWith(monitor, { name: 'LG UltraFine 32UQ85R', hid: undefined, video: true })

  assert.equal(monitor.profile.id, 'lg-32uq85r')
  const info = monitor.wizardInfo()
  assert.equal(info.selectedProfileId, 'lg-32uq85r')
  assert.equal(info.profiles.find((profile) => profile.id === 'lg-32uq85r').matchState, 'selected')
  assert.equal(info.profiles.find((profile) => profile.id === 'usb-display').matchState, 'available')
  assert.equal(info.profiles.find((profile) => profile.id === 'generic-ddc').matchState, 'fallback')
})

test('the wizard auto-matches a USB HID profile and reports the detected identity', async () => {
  const monitor = fixture()
  await detectWith(monitor, {
    name: 'External Display',
    hid: { vendorId: 1086, productId: 39481 },
    video: false,
  })

  assert.equal(monitor.profile.id, 'usb-display')
  const info = monitor.wizardInfo()
  assert.deepEqual(info.detectedUsbHid, { vendorId: 1086, productId: 39481 })
  assert.deepEqual(info.availableTransports, ['usb-hid-ddc'])
  assert.equal(info.profiles.find((profile) => profile.id === 'usb-display').matchState, 'selected')
})

test('manual profile selection is reported and reset returns to automatic matching', async () => {
  const monitor = fixture()
  monitor.profiles.push({ ...fallbackProfile, id: 'user-display', name: 'User Display', fallback: false })
  monitor.profileSources.set('user-display', 'user')

  await detectWith(monitor, { name: 'LG UltraFine 32UQ85R', hid: undefined, video: true })
  await monitor.activateProfile('user-display')

  assert.equal(monitor.profile.id, 'user-display')
  let info = monitor.wizardInfo()
  assert.equal(info.manualProfileId, 'user-display')
  assert.equal(info.profiles.find((profile) => profile.id === 'user-display').matchState, 'selected')
  assert.equal(info.profiles.find((profile) => profile.id === 'lg-32uq85r').matchState, 'match')

  await monitor.resetProfile()
  assert.equal(monitor.profile.id, 'lg-32uq85r')
  info = monitor.wizardInfo()
  assert.equal(info.manualProfileId, null)
  assert.equal(info.profiles.find((profile) => profile.id === 'lg-32uq85r').matchState, 'selected')
})

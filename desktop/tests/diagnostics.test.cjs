const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, readFileSync, appendFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const filename = path.resolve(__dirname, '../src/main/logger.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
const { transformSync } = require('esbuild')
compiled._compile(transformSync(readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code, filename)
const { LocalLogger } = compiled.exports

test('readRecent returns sanitized control records and ignores malformed lines', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'azoria-diagnostics-'))
  const logger = new LocalLogger(directory)

  logger.info('control.request', { control: 'brightness', source: 'touch' })
  logger.info('control.success', {
    control: 'brightness',
    source: 'touch',
    durationMs: 43,
    routeDurationMs: 12,
    reusedPreview: true,
  })
  logger.error('control.failed', {
    control: 'volume',
    error: 'DDC request failed',
  })
  await logger.readRecent()

  const file = logger.path
  appendFileSync(file, '{broken json\n', { encoding: 'utf8' })
  const records = await logger.readRecent()

  assert.equal(path.dirname(file), directory)
  assert.equal(records.length, 3)
  assert.deepEqual(records.map((record) => record.event), [
    'control.request',
    'control.success',
    'control.failed',
  ])
  assert.equal(records[1].durationMs, 43)
  assert.equal(records[1].routeDurationMs, 12)
  assert.equal(records[1].reusedPreview, true)
  assert.equal(records[2].level, 'error')
  assert.equal(records[2].error, 'DDC request failed')
  assert.equal(records[0].error, undefined)
})

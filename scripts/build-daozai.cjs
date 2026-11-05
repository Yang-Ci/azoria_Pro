const { spawnSync } = require('node:child_process')
const path = require('node:path')

if (process.platform !== 'win32') process.exit(0)
const result = spawnSync('cargo', ['build', '--locked', '--release', '--bin', 'daozai', '--manifest-path', path.join('desktop', 'daozai', 'Cargo.toml')], { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)

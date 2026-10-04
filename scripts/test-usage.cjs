const { buildSync } = require("esbuild")
const { spawnSync } = require("node:child_process")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const output = path.join(root, "out/tests/usage.test.cjs")
buildSync({ entryPoints: [path.join(root, "desktop/tests/usage.test.ts")], outfile: output, bundle: true, platform: "node", target: "node22", format: "cjs" })
const result = spawnSync(process.execPath, ["--test", output], { cwd: root, stdio: "inherit" })
process.exitCode = result.status ?? 1

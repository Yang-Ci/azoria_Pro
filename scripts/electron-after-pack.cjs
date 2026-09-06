"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const executableNames = new Set([
  "azoria-desktop",
  "chrome-sandbox",
  "chrome_crashpad_handler",
  "azoria-ddc-sidecar",
]);

function isLibrary(file) {
  return file.endsWith(".node") || file.endsWith(".so") || /\.so(\.\d+)+$/.test(file);
}

async function walk(root, handler) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    await handler(full, entry);
    if (entry.isDirectory()) {
      await walk(full, handler);
    }
  }
}

async function pruneSerialportPrebuilds(appOutDir) {
  const prebuilds = path.join(
    appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@serialport",
    "bindings-cpp",
    "prebuilds"
  );

  try {
    await fsp.access(prebuilds);
  } catch {
    return;
  }

  for (const entry of await fsp.readdir(prebuilds, { withFileTypes: true })) {
    if (entry.name !== "linux-x64") {
      await fsp.rm(path.join(prebuilds, entry.name), { recursive: true, force: true });
    }
  }

  const linuxX64 = path.join(prebuilds, "linux-x64");
  for (const file of await fsp.readdir(linuxX64)) {
    if (!file.endsWith(".glibc.node")) {
      await fsp.rm(path.join(linuxX64, file), { force: true });
    }
  }
}

async function normalizePermissions(appOutDir) {
  await walk(appOutDir, async (file, entry) => {
    if (entry.isDirectory()) {
      await fsp.chmod(file, 0o755);
      return;
    }

    const bytes = await fsp.readFile(file);
    const isElf = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const isScript = bytes.subarray(0, 2).toString("ascii") === "#!";
    const isExecutable = !isLibrary(file) && (executableNames.has(entry.name) || isElf || isScript);
    await fsp.chmod(file, isExecutable ? 0o755 : 0o644);
  });
}

function stripUnneededBinaries(appOutDir) {
  const files = [];
  const collect = (root) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (isLibrary(full)) {
        files.push(full);
      }
    }
  };
  collect(appOutDir);

  for (const file of files) {
    const result = spawnSync("strip", ["--strip-unneeded", file], { stdio: "inherit" });
    if (result.error != null || result.status !== 0) {
      throw new Error(`Unable to strip ${file}`);
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  await pruneSerialportPrebuilds(context.appOutDir);
  stripUnneededBinaries(context.appOutDir);
  await normalizePermissions(context.appOutDir);
};

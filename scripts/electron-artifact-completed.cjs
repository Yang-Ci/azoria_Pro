"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");

const executableNames = new Set([
  "azoria-desktop",
  "chrome-sandbox",
  "chrome_crashpad_handler",
  "azoria-ddc-sidecar",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, stdio: "pipe", encoding: "utf8" });
  if (result.error != null || result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${output}`);
  }
  return result.stdout;
}

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

async function normalizePermissions(root) {
  await walk(root, async (file, entry) => {
    if (entry.isDirectory()) {
      await fsp.chmod(file, 0o755);
      return;
    }
    if (!entry.isFile()) {
      return;
    }

    const bytes = await fsp.readFile(file);
    const isElf = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const isScript = bytes.subarray(0, 2).toString("ascii") === "#!";
    const isExecutable = !isLibrary(file) && (executableNames.has(entry.name) || isElf || isScript);
    await fsp.chmod(file, isExecutable ? 0o755 : 0o644);
  });
}

function normalizeDescriptionIndentation(controlText) {
  let inDescription = false;
  return controlText
    .split("\n")
    .map((line) => {
      if (line.startsWith("Description:")) {
        inDescription = true;
      } else if (inDescription && line.startsWith("  ")) {
        return line.slice(1);
      }
      return line;
    })
    .join("\n");
}

async function updateMd5sums(root, changedFile, digest) {
  const md5sums = path.join(root, "DEBIAN", "md5sums");
  let lines = [];
  try {
    lines = (await fsp.readFile(md5sums, "utf8")).split("\n").filter(Boolean);
  } catch {
    lines = [];
  }

  const prefix = `${digest}  `;
  const index = lines.findIndex((line) => line.endsWith(`  ${changedFile}`));
  if (index >= 0) {
    lines[index] = prefix + changedFile;
  } else {
    lines.push(prefix + changedFile);
  }
  await fsp.writeFile(md5sums, `${lines.join("\n")}\n`, { mode: 0o644 });
}

async function refreshUpdateInfo(context, artifact) {
  const digest = crypto.createHash("sha512");
  await fsp.readFile(artifact).then((data) => digest.update(data));
  const stats = await fsp.stat(artifact);
  context.updateInfo = {
    ...(context.updateInfo ?? {}),
    sha512: digest.digest("base64"),
    size: stats.size,
  };
}

exports.default = async function artifactBuildCompleted(context) {
  if (context.target?.name !== "deb") {
    return;
  }

  const artifact = context.file;
  const projectRoot = path.resolve(__dirname, "..");
  const changelog = path.join(projectRoot, "desktop", "packaging", "changelog");
  const changelogEntry = "usr/share/doc/azoria-display-control/changelog.gz";
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "azoria-deb-"));

  try {
    run("dpkg-deb", ["--root-owner-group", "--raw-extract", artifact, tempRoot]);

    const control = path.join(tempRoot, "DEBIAN", "control");
    const controlText = await fsp.readFile(control, "utf8");
    const cleanedControl = controlText
      .split("\n")
      .filter((line) => !/^(License|Vendor):/.test(line))
      .join("\n");
    await fsp.writeFile(control, normalizeDescriptionIndentation(cleanedControl), { mode: 0o644 });

    const changelogGz = path.join(tempRoot, changelogEntry);
    await fsp.mkdir(path.dirname(changelogGz), { recursive: true });
    const compressed = zlib.gzipSync(await fsp.readFile(changelog), {
      level: 9,
      mtime: 0,
    });
    await fsp.writeFile(changelogGz, compressed, { mode: 0o644 });

    const digest = crypto.createHash("md5").update(compressed).digest("hex");
    await updateMd5sums(tempRoot, changelogEntry, digest);
    await normalizePermissions(tempRoot);

    run("dpkg-deb", [
      "--root-owner-group",
      "-Z",
      "gzip",
      "-z",
      "9",
      "--build",
      tempRoot,
      artifact,
    ]);

    await refreshUpdateInfo(context, artifact);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
};

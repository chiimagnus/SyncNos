import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const webclipperRoot = join(repoRoot, "Extensions", "WebClipper");
if (!existsSync(join(webclipperRoot, "package.json"))) {
  throw new Error(`webclipper root not found: ${webclipperRoot}`);
}

const staging = join(webclipperRoot, ".tmp-amo-source");
const outZip = join(webclipperRoot, "SyncNos-WebClipper-amo-source.zip");
const repoLicense = join(repoRoot, "LICENSE");

rmSync(staging, { recursive: true, force: true });
rmSync(outZip, { force: true });
mkdirSync(staging, { recursive: true });

function copyIntoStaging(relPath) {
  const src = join(webclipperRoot, relPath);
  const dst = join(staging, relPath);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (srcPath) => basename(srcPath) !== ".DS_Store"
  });
}

function copyExternalIntoStaging(srcAbsPath, dstRelPath) {
  const dst = join(staging, dstRelPath);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(srcAbsPath, dst, {
    recursive: true,
    filter: (srcPath) => basename(srcPath) !== ".DS_Store"
  });
}

function removeJunkFilesRecursively(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === ".DS_Store") {
        rmSync(abs, { force: true });
      }
    }
  }
}

// Minimal, reviewer-friendly source package contents.
// Keep only what reviewers need to reproduce the XPI build.
const requiredItems = [
  "wxt.config.ts",
  "tsconfig.json",
  "postcss.config.cjs",
  "tailwind.config.cjs",
  "entrypoints",
  "icons",
  "src",
  "package.json",
  "package-lock.json",
  "AGENTS.md"
];

const optionalItems = [
  // Some setups may not have a top-level `scripts/` directory.
  "scripts"
];

for (const item of requiredItems) {
  const p = join(webclipperRoot, item);
  if (!existsSync(p)) throw new Error(`missing: ${item}`);
  copyIntoStaging(item);
}

for (const item of optionalItems) {
  const p = join(webclipperRoot, item);
  if (!existsSync(p)) continue;
  copyIntoStaging(item);
}

if (existsSync(repoLicense)) {
  copyExternalIntoStaging(repoLicense, "LICENSE");
}

const ciScriptsDir = join(repoRoot, ".github", "scripts", "webclipper");
if (existsSync(ciScriptsDir)) {
  copyExternalIntoStaging(ciScriptsDir, ".github/scripts/webclipper");
}

removeJunkFilesRecursively(staging);

// `.zip` is the required format for AMO "Source code".
run("zip", ["-r", outZip, "."], staging);

rmSync(staging, { recursive: true, force: true });

// eslint-disable-next-line no-console
console.log(`[package] amo source: ${outZip}`);

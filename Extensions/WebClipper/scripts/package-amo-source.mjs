import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;
const staging = join(root, ".tmp-amo-source");
const outZip = join(root, "SyncNos-WebClipper-amo-source.zip");
const repoLicense = join(root, "..", "..", "LICENSE");

rmSync(staging, { recursive: true, force: true });
rmSync(outZip, { force: true });
mkdirSync(staging, { recursive: true });

function copyIntoStaging(relPath) {
  const src = join(root, relPath);
  const dst = join(staging, relPath);
  const dstDir = dst.split("/").slice(0, -1).join("/");
  mkdirSync(dstDir, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (srcPath) => basename(srcPath) !== ".DS_Store"
  });
}

function copyExternalIntoStaging(srcAbsPath, dstRelPath) {
  const dst = join(staging, dstRelPath);
  const dstDir = dst.split("/").slice(0, -1).join("/");
  mkdirSync(dstDir, { recursive: true });
  cpSync(srcAbsPath, dst);
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
const items = [
  "wxt.config.ts",
  "tsconfig.json",
  "postcss.config.cjs",
  "tailwind.config.cjs",
  "entrypoints",
  "icons",
  "src",
  "scripts",
  "package.json",
  "package-lock.json",
  "AGENTS.md"
];

for (const item of items) {
  const p = join(root, item);
  if (!existsSync(p)) throw new Error(`missing: ${item}`);
  copyIntoStaging(item);
}

if (existsSync(repoLicense)) {
  copyExternalIntoStaging(repoLicense, "LICENSE");
}

removeJunkFilesRecursively(staging);

// `.zip` is the required format for AMO "Source code".
run("zip", ["-r", outZip, "."], staging);

rmSync(staging, { recursive: true, force: true });

// eslint-disable-next-line no-console
console.log(`[package] amo source: ${outZip}`);

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;
const staging = join(root, ".tmp-amo-source");
const outZip = join(root, "SyncNos-WebClipper-amo-source.zip");

rmSync(staging, { recursive: true, force: true });
rmSync(outZip, { force: true });
mkdirSync(staging, { recursive: true });

function copyIntoStaging(relPath) {
  const src = join(root, relPath);
  const dst = join(staging, relPath);
  const dstDir = dst.split("/").slice(0, -1).join("/");
  mkdirSync(dstDir, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

// Minimal, reviewer-friendly source package contents.
// Keep only what reviewers need to reproduce the XPI build.
const items = [
  "manifest.json",
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

// `.zip` is the required format for AMO "Source code".
run("zip", ["-r", outZip, "."], staging);

rmSync(staging, { recursive: true, force: true });

// eslint-disable-next-line no-console
console.log(`[package] amo source: ${outZip}`);

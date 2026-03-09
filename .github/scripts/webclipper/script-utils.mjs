import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRepoRoot(importMetaUrl) {
  const scriptDir = dirname(fileURLToPath(importMetaUrl));
  return resolve(scriptDir, "..", "..", "..");
}

export function resolveWebclipperRoot(repoRoot) {
  const webclipperRoot = join(repoRoot, "webclipper");
  if (!existsSync(join(webclipperRoot, "package.json"))) {
    throw new Error(`webclipper root not found: ${webclipperRoot}`);
  }
  return webclipperRoot;
}

export function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}


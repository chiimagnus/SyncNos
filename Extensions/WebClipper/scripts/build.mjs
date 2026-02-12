import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Copy a loadable extension folder into dist/extension (manifest at root).
const out = join(dist, "extension");
mkdirSync(out, { recursive: true });

for (const item of ["manifest.json", "src", "icons"]) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}

// Optional zip (uses system zip if available).
const zipPath = join(dist, "webclipper.zip");
if (existsSync("/usr/bin/zip") || spawnSync("which", ["zip"]).status === 0) {
  rmSync(zipPath, { force: true });
  run("zip", ["-r", zipPath, "."], out);
}

// eslint-disable-next-line no-console
console.log(`[build] dist: ${out}`);


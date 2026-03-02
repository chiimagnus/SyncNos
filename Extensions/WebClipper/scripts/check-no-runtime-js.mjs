import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const TARGET_DIRS = ['src', 'entrypoints'];
const ALLOWLIST = new Set([
  'src/vendor/readability.js',
]);

function toPosixPath(value) {
  return value.split('\\').join('/');
}

function walkFiles(dirPath, output) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    output.push(absolutePath);
  }
}

const runtimeJsFiles = [];

for (const targetDir of TARGET_DIRS) {
  const targetPath = join(ROOT, targetDir);
  const targetStats = statSync(targetPath, { throwIfNoEntry: false });
  if (!targetStats || !targetStats.isDirectory()) continue;

  const absoluteFiles = [];
  walkFiles(targetPath, absoluteFiles);
  for (const filePath of absoluteFiles) {
    if (!filePath.endsWith('.js')) continue;
    runtimeJsFiles.push(toPosixPath(relative(ROOT, filePath)));
  }
}

runtimeJsFiles.sort();
const disallowed = runtimeJsFiles.filter((filePath) => !ALLOWLIST.has(filePath));

if (disallowed.length) {
  console.error('[check-no-runtime-js] Disallowed runtime .js files found in src/entrypoints:');
  for (const filePath of disallowed) {
    console.error(` - ${filePath}`);
  }
  console.error('[check-no-runtime-js] Keep runtime sources in TypeScript; move third-party JS assets to allowlist only.');
  process.exit(1);
}

console.log(`[check-no-runtime-js] OK (${runtimeJsFiles.length} runtime .js file(s), allowlist size: ${ALLOWLIST.size})`);

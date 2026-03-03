import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PATTERN = String.raw`runtimeContext\b|globalThis\.WebClipper`;

function findWebClipperRoot(fromDir) {
  const direct = path.join(fromDir, 'src');
  if (fs.existsSync(direct)) return fromDir;

  const nested = path.join(fromDir, 'Extensions', 'WebClipper', 'src');
  if (fs.existsSync(nested)) return path.join(fromDir, 'Extensions', 'WebClipper');

  return fromDir;
}

function runRg(rootDir) {
  return spawnSync(
    'rg',
    ['-n', PATTERN, path.join(rootDir, 'src'), path.join(rootDir, 'entrypoints'), path.join(rootDir, 'tests')],
    { encoding: 'utf8' },
  );
}

function collectFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.output' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function runFallbackScan(rootDir) {
  const targets = ['src', 'entrypoints', 'tests'].map((p) => path.join(rootDir, p));
  const files = [];
  for (const t of targets) collectFiles(t, files);

  const re = new RegExp(PATTERN);
  const hits = [];
  for (const file of files) {
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (re.test(content)) hits.push(file);
  }
  return hits;
}

const webClipperRoot = findWebClipperRoot(process.cwd());

const rg = runRg(webClipperRoot);
if (rg.error) {
  const hits = runFallbackScan(webClipperRoot);
  if (hits.length) {
    console.error('[check:no-compat] Found compat-layer references (fallback scan):');
    for (const file of hits) console.error(`- ${path.relative(webClipperRoot, file)}`);
    process.exit(1);
  }
  console.log('[check:no-compat] OK (fallback scan): no compat-layer references.');
  process.exit(0);
}

if (rg.status === 0) {
  // rg exit 0 => matches found
  process.stderr.write(rg.stdout || '');
  process.stderr.write(rg.stderr || '');
  console.error('[check:no-compat] Found compat-layer references.');
  process.exit(1);
}

if (rg.status === 1) {
  // rg exit 1 => no matches
  console.log('[check:no-compat] OK: no compat-layer references.');
  process.exit(0);
}

process.stderr.write(rg.stdout || '');
process.stderr.write(rg.stderr || '');
console.error(`[check:no-compat] rg failed with exit code ${rg.status}.`);
process.exit(rg.status ?? 2);

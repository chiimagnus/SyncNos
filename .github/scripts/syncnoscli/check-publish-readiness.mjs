import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const PACKAGE_NAME = '@chiimagnus/syncnoscli';
const EXPECTED_REGISTRY = 'https://registry.npmjs.org/';
const EXPECTED_ENGINE = '>=22';
const EXPECTED_FILES = Object.freeze(['dist/**', 'prebuilds/**', 'README.md', 'README.zh-CN.md']);
const EXPECTED_REPOSITORY = 'https://github.com/SyncNos/SyncNos-Webclipper.git';
const EXPECTED_TAG = 'latest';
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(`[syncnoscli-publish] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { offline: false, expectedVersion: null, confirmation: null };
  for (const raw of argv) {
    if (raw === '--offline') {
      result.offline = true;
      continue;
    }
    if (raw.startsWith('--expected-version=')) {
      result.expectedVersion = raw.slice('--expected-version='.length);
      continue;
    }
    if (raw.startsWith('--confirmation=')) {
      result.confirmation = raw.slice('--confirmation='.length);
      continue;
    }
    fail('unsupported argument');
  }
  return result;
}

function strictString(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) fail(`${label} is invalid`);
  return value.trim();
}

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const packageRoot = resolve(repoRoot, 'packages/syncnoscli');
const args = parseArgs(process.argv.slice(2));
let packageJson;
try {
  packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
} catch {
  fail('package.json is unreadable');
}

if (packageJson.name !== PACKAGE_NAME) fail('package name mismatch');
const version = strictString(packageJson.version, 'package version');
if (!VERSION_PATTERN.test(version)) fail('package version is not valid semver');
if (packageJson.private === true) fail('package must not be private');
if (packageJson.engines?.node !== EXPECTED_ENGINE) fail('Node engine mismatch');
if (JSON.stringify(packageJson.files) !== JSON.stringify(EXPECTED_FILES)) fail('published files allowlist mismatch');
if (packageJson.repository?.type !== 'git' || packageJson.repository?.url !== EXPECTED_REPOSITORY) {
  fail('repository metadata mismatch');
}
if (packageJson.publishConfig?.access !== 'public') fail('publish access must be public');
if (packageJson.publishConfig?.provenance !== true) fail('publish provenance must be enabled');
if (packageJson.publishConfig?.registry !== EXPECTED_REGISTRY) fail('publish registry mismatch');
if (packageJson.publishConfig?.tag !== EXPECTED_TAG) fail('publish tag must be latest');
if (packageJson.scripts?.prepack !== 'node build.mjs') fail('prepack must rebuild the package');

if (args.expectedVersion !== null && strictString(args.expectedVersion, 'expected version') !== version) {
  fail('requested version does not match package version');
}
if (args.confirmation !== null) {
  const expected = `PUBLISH ${PACKAGE_NAME}@${version}`;
  if (strictString(args.confirmation, 'confirmation') !== expected) fail('explicit confirmation mismatch');
}

if (!args.offline) {
  const registry = String(process.env.npm_config_registry || EXPECTED_REGISTRY).trim();
  if (registry !== EXPECTED_REGISTRY) fail('npm registry must be the public registry');
}

console.log(`[syncnoscli-publish] ready ${PACKAGE_NAME}@${version}`);

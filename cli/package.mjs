#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, '..');
const DEV_VERSION = '0.0.0-dev';
const PACKAGE_NAME = 'syncnos-cli';

export const CLI_PACKAGE_RUNTIME_FILES = Object.freeze([
  'browser-targets.mjs',
  'contract.mjs',
  'file-transfer.mjs',
  'install.mjs',
  'ipc.mjs',
  'native-host.mjs',
  'runtime-registry.mjs',
  'syncnos.mjs',
  'user-config.mjs',
]);

function packageError(code, message, extra = null) {
  const error = new Error(message || code);
  error.code = code;
  error.extra = extra;
  return error;
}

export function isNpmSemver(value) {
  const text = String(value || '').trim();
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    text,
  );
}

export function semverCore(value) {
  const text = String(value || '').trim();
  if (!isNpmSemver(text)) throw packageError('invalid_semver', `Invalid npm semver: ${text || '(empty)'}`);
  return text.split(/[+-]/, 1)[0];
}

export function assertReleaseCoreMatchesWxt(releaseVersion, wxtVersion) {
  const releaseCore = semverCore(releaseVersion);
  const wxtCore = semverCore(wxtVersion);
  if (releaseCore !== wxtCore) {
    throw packageError(
      'release_version_mismatch',
      `Release core ${releaseCore} does not match WXT version ${wxtCore}`,
      {
        releaseVersion,
        wxtVersion,
      },
    );
  }
  return true;
}

export async function readWxtManifestVersion({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const source = await readFile(join(resolve(repoRoot), 'wxt.config.ts'), 'utf8');
  const match = source.match(/\bversion:\s*['"]([^'"]+)['"]/);
  const version = String(match?.[1] || '').trim();
  if (!isNpmSemver(version))
    throw packageError('wxt_version_invalid', 'wxt.config.ts manifest.version is missing or invalid');
  return version;
}

export function resolveCliPackageVersion({ explicitVersion, wxtVersion }) {
  const explicit = String(explicitVersion || '').trim();
  if (explicit) {
    if (!isNpmSemver(explicit)) throw packageError('invalid_semver', `Invalid npm semver: ${explicit}`);
    return explicit;
  }
  const fallback = String(wxtVersion || '').trim();
  if (!isNpmSemver(fallback)) throw packageError('wxt_version_invalid', 'WXT manifest version is invalid');
  return fallback;
}

async function readSourcePackageJson(repoRoot) {
  const path = join(repoRoot, 'cli', 'package.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value?.name !== PACKAGE_NAME)
    throw packageError('package_name_invalid', `CLI package name must be ${PACKAGE_NAME}`);
  if (value?.version !== DEV_VERSION) {
    throw packageError('dev_version_invalid', `cli/package.json must keep dev placeholder ${DEV_VERSION}`);
  }
  if (value?.private !== true) throw packageError('package_private_required', 'CLI package must remain private:true');
  if (value?.bin?.syncnos !== './syncnos.mjs')
    throw packageError('package_bin_invalid', 'CLI package bin.syncnos is invalid');
  const dependencies = value?.dependencies && typeof value.dependencies === 'object' ? value.dependencies : {};
  if (Object.keys(dependencies).length !== 0)
    throw packageError('package_dependencies_forbidden', 'CLI package must have zero dependencies');
  return value;
}

export async function prepareCliPackage({ repoRoot = DEFAULT_REPO_ROOT, stagingDir, version } = {}) {
  const root = resolve(repoRoot);
  const wxtVersion = await readWxtManifestVersion({ repoRoot: root });
  const packageVersion = resolveCliPackageVersion({ explicitVersion: version, wxtVersion });
  const stage = resolve(stagingDir || join(root, '.output', 'cli', 'staging', PACKAGE_NAME));
  const sourcePackage = await readSourcePackageJson(root);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const stagedPackage = { ...sourcePackage, version: packageVersion };
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(stagedPackage, null, 2)}\n`, 'utf8');
  for (const file of CLI_PACKAGE_RUNTIME_FILES) {
    await cp(join(root, 'cli', file), join(stage, file));
  }

  const canonicalContractPath = join(root, 'src', 'services', 'protocols', 'cli-rpc-contract.json');
  const canonicalContract = await readFile(canonicalContractPath);
  const stagedContractPath = join(stage, 'cli-rpc-contract.json');
  await writeFile(stagedContractPath, canonicalContract);
  const stagedContract = await readFile(stagedContractPath);
  if (!canonicalContract.equals(stagedContract)) {
    throw packageError('contract_copy_mismatch', 'Staged CLI RPC contract differs from canonical source');
  }

  return {
    packageName: PACKAGE_NAME,
    packageVersion,
    wxtVersion,
    stagingDir: stage,
    packageJsonPath: join(stage, 'package.json'),
    canonicalContractPath,
    stagedContractPath,
  };
}

export async function packageCli({
  repoRoot = DEFAULT_REPO_ROOT,
  stagingDir,
  outDir,
  version,
  checkOnly = false,
  requireWxtCoreMatch = false,
} = {}) {
  const root = resolve(repoRoot);
  const prepared = await prepareCliPackage({ repoRoot: root, stagingDir, version });
  if (requireWxtCoreMatch) assertReleaseCoreMatchesWxt(prepared.packageVersion, prepared.wxtVersion);
  if (checkOnly) return { ...prepared, tarballPath: null };
  const outputDir = resolve(outDir || join(root, '.output', 'cli'));
  await mkdir(outputDir, { recursive: true });
  const stdout = execFileSync('npm', ['pack', '--pack-destination', outputDir], {
    cwd: prepared.stagingDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const filename = String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  if (!filename) throw packageError('npm_pack_failed', 'npm pack did not return a tarball name');
  const expected = `${PACKAGE_NAME}-${prepared.packageVersion}.tgz`;
  if (filename !== expected) {
    throw packageError('npm_pack_name_mismatch', `Unexpected npm pack output: ${filename}`, { expected });
  }
  return { ...prepared, tarballPath: join(outputDir, filename) };
}

function parseArgs(argv) {
  const args = { version: null, checkOnly: false, outDir: null, requireWxtCoreMatch: false };
  const input = Array.from(argv || []);
  while (input.length) {
    const token = input.shift();
    if (token === '--check') {
      args.checkOnly = true;
      continue;
    }
    if (token === '--require-wxt-core-match') {
      args.requireWxtCoreMatch = true;
      continue;
    }
    if (token === '--version') {
      const value = String(input.shift() || '').trim();
      if (!value) throw packageError('usage_error', '--version requires a value');
      args.version = value;
      continue;
    }
    if (String(token).startsWith('--version=')) {
      args.version = String(token).slice('--version='.length).trim();
      if (!args.version) throw packageError('usage_error', '--version requires a value');
      continue;
    }
    if (token === '--out') {
      const value = String(input.shift() || '').trim();
      if (!value) throw packageError('usage_error', '--out requires a value');
      args.outDir = value;
      continue;
    }
    throw packageError('usage_error', `Unknown CLI package option: ${token}`);
  }
  return args;
}

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await packageCli({
      version: args.version,
      checkOnly: args.checkOnly,
      outDir: args.outDir,
      requireWxtCoreMatch: args.requireWxtCoreMatch,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.code || 'cli_package_failed')}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

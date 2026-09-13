import { randomUUID } from 'node:crypto';
import { access, chmod, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildNativeHostManifest,
  listBrowserTargets,
  resolveBrowserTarget,
  validateNativeHostManifest,
} from './browser-targets.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const LAUNCHER_RELATIVE_PATH = 'Library/Application Support/SyncNos/cli/native-host';

function installError(code, message, extra = null) {
  const error = new Error(message || code);
  error.code = code;
  error.extra = extra;
  return error;
}

function resolveHomeDir(homeDir) {
  const input = String(homeDir || process.env.HOME || '').trim();
  if (!input) throw installError('home_unavailable', 'Home directory is unavailable');
  return resolve(input);
}

export function currentCliPackagePaths() {
  return {
    packageDir: MODULE_DIR,
    packageJsonPath: join(MODULE_DIR, 'package.json'),
    nativeHostPath: join(MODULE_DIR, 'native-host.mjs'),
  };
}

export function resolveCliSupportPaths({ homeDir } = {}) {
  const home = resolveHomeDir(homeDir);
  const launcherPath = resolve(home, LAUNCHER_RELATIVE_PATH);
  return { homeDir: home, supportDir: dirname(launcherPath), launcherPath };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function buildNativeHostLauncher({ nodePath, nativeHostPath }) {
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  if (!isAbsolute(node) || !isAbsolute(host)) {
    throw installError('launcher_path_invalid', 'Native host launcher requires absolute Node and host paths');
  }
  return `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(host)} "$@"\n`;
}

async function pathState(path) {
  try {
    const stat = await lstat(path);
    return {
      present: true,
      mode: stat.mode & 0o777,
      regularFile: stat.isFile(),
      directory: stat.isDirectory(),
      symbolicLink: stat.isSymbolicLink(),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { present: false, mode: null, regularFile: false, directory: false, symbolicLink: false };
    }
    throw error;
  }
}

async function atomicWrite(path, content, mode) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', mode, flag: 'wx' });
    await chmod(tempPath, mode);
    await rename(tempPath, path);
    await chmod(path, mode);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function assertExecutableNode(nodePath) {
  if (!isAbsolute(nodePath)) throw installError('node_path_invalid', 'Node executable path must be absolute');
  try {
    await access(nodePath, fsConstants.X_OK);
  } catch (error) {
    throw installError('node_unavailable', `Node executable is unavailable: ${nodePath}`, {
      cause: String(error?.code || error?.message || error),
    });
  }
}

async function assertNativeHostScript(nativeHostPath) {
  if (!isAbsolute(nativeHostPath)) throw installError('native_host_path_invalid', 'Native host path must be absolute');
  const state = await pathState(nativeHostPath);
  if (!state.present || !state.regularFile || state.symbolicLink) {
    throw installError('native_host_unavailable', `Native host script is unavailable: ${nativeHostPath}`);
  }
}

async function removeExactFile(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonFile(path) {
  try {
    return { present: true, value: JSON.parse(await readFile(path, 'utf8')), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, value: null, error: null };
    return { present: true, value: null, error: String(error?.message || error) };
  }
}

export async function installNativeHost({
  browser,
  extensionId,
  homeDir,
  platform = process.platform,
  nodePath = process.execPath,
  nativeHostPath = currentCliPackagePaths().nativeHostPath,
} = {}) {
  if (platform !== 'darwin')
    throw installError('unsupported_platform', 'SyncNos CLI install currently supports macOS only');
  const target = resolveBrowserTarget(browser, { homeDir: resolveHomeDir(homeDir), extensionId });
  const support = resolveCliSupportPaths({ homeDir });
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  await assertExecutableNode(node);
  await assertNativeHostScript(host);

  await mkdir(support.supportDir, { recursive: true, mode: 0o700 });
  await chmod(support.supportDir, 0o700);
  const launcher = buildNativeHostLauncher({ nodePath: node, nativeHostPath: host });
  await atomicWrite(support.launcherPath, launcher, 0o700);

  const manifest = buildNativeHostManifest(target, support.launcherPath);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWrite(target.manifestPath, manifestText, 0o600);

  const [launcherReadback, manifestReadback] = await Promise.all([
    readFile(support.launcherPath, 'utf8'),
    readJsonFile(target.manifestPath),
  ]);
  if (launcherReadback !== launcher)
    throw installError('launcher_readback_mismatch', 'Native host launcher read-back mismatch');
  if (!manifestReadback.value) throw installError('manifest_readback_failed', 'Native host manifest read-back failed');
  const validation = validateNativeHostManifest(target, manifestReadback.value, support.launcherPath);
  if (!validation.valid) {
    throw installError('manifest_readback_mismatch', 'Native host manifest read-back mismatch', {
      issues: validation.issues,
    });
  }

  return {
    browser: target.id,
    extensionId: target.extensionId,
    productionIdentity: target.productionIdentity,
    launcherPath: support.launcherPath,
    manifestPath: target.manifestPath,
    nativeHostPath: host,
    nodePath: node,
  };
}

export async function uninstallNativeHost({ browser, homeDir, platform = process.platform } = {}) {
  if (platform !== 'darwin')
    throw installError('unsupported_platform', 'SyncNos CLI uninstall currently supports macOS only');
  const home = resolveHomeDir(homeDir);
  const browsers = browser ? [String(browser).trim().toLowerCase()] : listBrowserTargets();
  const removedManifests = [];
  for (const browserId of browsers) {
    const target = resolveBrowserTarget(browserId, { homeDir: home });
    if (await removeExactFile(target.manifestPath))
      removedManifests.push({ browser: target.id, path: target.manifestPath });
  }

  const remaining = [];
  for (const browserId of listBrowserTargets()) {
    const target = resolveBrowserTarget(browserId, { homeDir: home });
    if ((await pathState(target.manifestPath)).present)
      remaining.push({ browser: target.id, path: target.manifestPath });
  }

  const support = resolveCliSupportPaths({ homeDir: home });
  let launcherRemoved = false;
  if (remaining.length === 0) {
    launcherRemoved = await removeExactFile(support.launcherPath);
    try {
      await rmdir(support.supportDir);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(String(error?.code || ''))) throw error;
    }
  }

  return {
    browsers,
    removedManifests,
    remainingManifests: remaining,
    launcherRemoved,
    launcherPath: support.launcherPath,
  };
}

async function inspectLauncher({ launcherPath, expectedLauncher }) {
  const state = await pathState(launcherPath);
  if (!state.present)
    return { path: launcherPath, ...state, executable: false, modeValid: false, matchesCurrentPackage: false };
  let contents = '';
  try {
    contents = await readFile(launcherPath, 'utf8');
  } catch {
    // state below reports the mismatch
  }
  return {
    path: launcherPath,
    ...state,
    executable: (state.mode & 0o111) !== 0,
    modeValid: state.mode === 0o700,
    matchesCurrentPackage: state.regularFile && !state.symbolicLink && contents === expectedLauncher,
  };
}

async function inspectManifest(target, launcherPath) {
  const state = await pathState(target.manifestPath);
  if (!state.present) {
    return {
      browser: target.id,
      path: target.manifestPath,
      present: false,
      valid: false,
      issues: ['manifest_missing'],
      productionIdentity: false,
      mode: null,
    };
  }
  const parsed = await readJsonFile(target.manifestPath);
  const validation = parsed.value
    ? validateNativeHostManifest(target, parsed.value, launcherPath)
    : { valid: false, issues: ['manifest_invalid_json'], productionIdentity: false };
  const issues = parsed.error ? ['manifest_invalid_json'] : [...validation.issues];
  if (state.mode !== 0o600) issues.push('manifest_mode');
  return {
    browser: target.id,
    path: target.manifestPath,
    present: true,
    valid: validation.valid && state.mode === 0o600,
    issues,
    productionIdentity: validation.productionIdentity,
    mode: state.mode,
    allowlist: parsed.value?.[target.allowlistField] ?? null,
  };
}

export async function inspectCliInstallation({
  homeDir,
  platform = process.platform,
  nodePath = process.execPath,
  nativeHostPath = currentCliPackagePaths().nativeHostPath,
} = {}) {
  const home = resolveHomeDir(homeDir);
  const support = resolveCliSupportPaths({ homeDir: home });
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  const expectedLauncher = buildNativeHostLauncher({ nodePath: node, nativeHostPath: host });
  const [nodeState, hostState, launcher, packageJson] = await Promise.all([
    pathState(node),
    pathState(host),
    inspectLauncher({ launcherPath: support.launcherPath, expectedLauncher }),
    readJsonFile(currentCliPackagePaths().packageJsonPath),
  ]);
  const browsers = [];
  for (const browser of listBrowserTargets()) {
    const target = resolveBrowserTarget(browser, { homeDir: home });
    browsers.push(await inspectManifest(target, support.launcherPath));
  }
  return {
    platform,
    platformSupported: platform === 'darwin',
    package: {
      packageDir: currentCliPackagePaths().packageDir,
      packageJsonPath: currentCliPackagePaths().packageJsonPath,
      packagePresent: packageJson.present && !!packageJson.value,
      name: packageJson.value?.name || null,
      version: packageJson.value?.version || null,
      nodePath: node,
      nodePresent: nodeState.present,
      nodeExecutable: nodeState.present
        ? await access(node, fsConstants.X_OK)
            .then(() => true)
            .catch(() => false)
        : false,
      nativeHostPath: host,
      nativeHostPresent: hostState.present && hostState.regularFile && !hostState.symbolicLink,
    },
    launcher,
    browsers,
  };
}

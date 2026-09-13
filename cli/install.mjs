import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, posix, win32 } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildNativeHostManifest,
  discoverInstalledBrowsers,
  listBrowserTargets,
  resolveRegistrationTargets,
  validateNativeHostManifest,
} from './browser-targets.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

function installError(code, message, extra = null) {
  const error = new Error(message || code);
  error.code = code;
  error.extra = extra;
  return error;
}

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix;
}

function envValue(env, ...names) {
  for (const name of names) {
    const value = String(env?.[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function resolveHomeDir(homeDir, { platform = process.platform, env = process.env } = {}) {
  const input = String(homeDir || envValue(env, 'HOME', 'USERPROFILE') || '').trim();
  if (!input) throw installError('home_unavailable', 'Home directory is unavailable');
  return pathApi(platform).resolve(input);
}

function assertSupportedPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw installError('unsupported_platform', `SyncNos CLI install does not support ${platform}`);
  }
}

export function currentCliPackagePaths() {
  return {
    packageDir: MODULE_DIR,
    packageJsonPath: join(MODULE_DIR, 'package.json'),
    nativeHostPath: join(MODULE_DIR, 'native-host.mjs'),
  };
}

export function resolveCliSupportPaths({
  platform = process.platform,
  homeDir,
  localAppDataDir,
  xdgDataHome,
  env = process.env,
} = {}) {
  assertSupportedPlatform(platform);
  const path = pathApi(platform);
  if (platform === 'win32') {
    const localAppData = String(localAppDataDir || envValue(env, 'LOCALAPPDATA') || '').trim();
    if (!localAppData) throw installError('local_app_data_unavailable', 'LOCALAPPDATA is unavailable');
    const supportDir = path.resolve(localAppData, 'SyncNos', 'cli');
    return {
      homeDir: String(homeDir || envValue(env, 'USERPROFILE') || '').trim() || null,
      supportDir,
      launcherPath: path.resolve(supportDir, 'native-host.bat'),
      manifestDir: path.resolve(supportDir, 'manifests'),
    };
  }

  const home = resolveHomeDir(homeDir, { platform, env });
  const supportDir =
    platform === 'darwin'
      ? path.resolve(home, 'Library/Application Support/SyncNos/cli')
      : path.resolve(
          String(xdgDataHome || envValue(env, 'XDG_DATA_HOME') || path.join(home, '.local/share')),
          'SyncNos/cli',
        );
  return {
    homeDir: home,
    supportDir,
    launcherPath: path.resolve(supportDir, 'native-host'),
    manifestDir: path.resolve(supportDir, 'manifests'),
  };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function batchQuote(value) {
  const text = String(value || '');
  if (!text || /[\r\n"]/.test(text)) throw installError('launcher_path_invalid', 'Windows launcher path is invalid');
  return `"${text.replaceAll('%', '%%')}"`;
}

export function buildNativeHostLauncher({ nodePath, nativeHostPath, platform = process.platform }) {
  const path = pathApi(platform);
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  if (!path.isAbsolute(node) || !path.isAbsolute(host)) {
    throw installError('launcher_path_invalid', 'Native host launcher requires absolute Node and host paths');
  }
  if (platform === 'win32') {
    return [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'chcp 65001 >nul',
      `${batchQuote(node)} ${batchQuote(host)} %*`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n');
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

async function atomicWrite(path, content, mode, { platform = process.platform } = {}) {
  await mkdir(pathApi(platform).dirname(path), { recursive: true, ...(platform === 'win32' ? {} : { mode: 0o700 }) });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, {
      encoding: 'utf8',
      ...(platform === 'win32' ? {} : { mode }),
      flag: 'wx',
    });
    if (platform !== 'win32') await chmod(tempPath, mode);
    await rename(tempPath, path);
    if (platform !== 'win32') await chmod(path, mode);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function assertExecutableNode(nodePath, platform) {
  if (!pathApi(platform).isAbsolute(nodePath))
    throw installError('node_path_invalid', 'Node executable path must be absolute');
  try {
    await access(nodePath, fsConstants.X_OK);
  } catch (error) {
    throw installError('node_unavailable', `Node executable is unavailable: ${nodePath}`, {
      cause: String(error?.code || error?.message || error),
    });
  }
}

async function assertNativeHostScript(nativeHostPath, platform) {
  if (!pathApi(platform).isAbsolute(nativeHostPath))
    throw installError('native_host_path_invalid', 'Native host path must be absolute');
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

function decodeWindowsOutput(value) {
  if (typeof value === 'string') return value;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length) return '';
  const hasUtf16Bom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
  let zeroHighBytes = 0;
  for (let index = 1; index < buffer.length; index += 2) if (buffer[index] === 0) zeroHighBytes += 1;
  if (hasUtf16Bom || zeroHighBytes > buffer.length / 8) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  return buffer.toString('utf8');
}

async function defaultWindowsRegistryRunner(executable, args) {
  return await new Promise((resolve) => {
    execFile(executable, args, { windowsHide: true, encoding: null }, (error, stdout, stderr) => {
      resolve({
        status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        errorCode: error && !Number.isInteger(error.code) ? String(error.code || '') : null,
        stdout: stdout || Buffer.alloc(0),
        stderr: stderr || Buffer.alloc(0),
      });
    });
  });
}

function normalizeRegistryResult(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : 0,
    errorCode: result?.errorCode ? String(result.errorCode) : null,
    stdout: decodeWindowsOutput(result?.stdout),
    stderr: decodeWindowsOutput(result?.stderr),
  };
}

async function runRegistry(args, registryRunner) {
  const result = normalizeRegistryResult(await (registryRunner || defaultWindowsRegistryRunner)('reg.exe', args));
  if (result.errorCode) {
    throw installError('registry_unavailable', `Windows Registry command failed: ${result.errorCode}`);
  }
  return result;
}

export async function queryWindowsRegistryValue(registryKey, { registryRunner } = {}) {
  const key = String(registryKey || '').trim();
  if (!key) throw installError('registry_key_invalid', 'Windows Registry key is required');
  const result = await runRegistry(['QUERY', key, '/ve'], registryRunner);
  if (result.status === 1) return { present: false, value: null };
  if (result.status !== 0) {
    throw installError('registry_query_failed', `Windows Registry query failed for ${key}`, { stderr: result.stderr });
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /\sREG_SZ\s+/.exec(line);
    if (!match) continue;
    const value = line.slice(match.index + match[0].length).trim();
    if (value) return { present: true, value };
  }
  throw installError('registry_readback_invalid', `Windows Registry value is invalid for ${key}`);
}

export async function writeWindowsRegistryValue(registryKey, manifestPath, { registryRunner } = {}) {
  const key = String(registryKey || '').trim();
  const path = String(manifestPath || '').trim();
  if (!key || !path)
    throw installError('registry_write_invalid', 'Windows Registry key and manifest path are required');
  const result = await runRegistry(['ADD', key, '/ve', '/t', 'REG_SZ', '/d', path, '/f'], registryRunner);
  if (result.status !== 0) {
    throw installError('registry_write_failed', `Windows Registry write failed for ${key}`, { stderr: result.stderr });
  }
  const readback = await queryWindowsRegistryValue(key, { registryRunner });
  if (!readback.present || readback.value !== path) {
    throw installError('registry_readback_mismatch', `Windows Registry read-back mismatch for ${key}`, {
      expected: path,
      actual: readback.value,
    });
  }
  return readback;
}

export async function deleteWindowsRegistryValue(registryKey, { registryRunner } = {}) {
  const key = String(registryKey || '').trim();
  if (!key) throw installError('registry_key_invalid', 'Windows Registry key is required');
  const before = await queryWindowsRegistryValue(key, { registryRunner });
  if (!before.present) return false;
  const result = await runRegistry(['DELETE', key, '/f'], registryRunner);
  if (result.status !== 0) {
    throw installError('registry_delete_failed', `Windows Registry delete failed for ${key}`, {
      stderr: result.stderr,
    });
  }
  const readback = await queryWindowsRegistryValue(key, { registryRunner });
  if (readback.present)
    throw installError('registry_delete_readback_failed', `Windows Registry key still exists: ${key}`);
  return true;
}

function targetManifestPath(target, support) {
  if (target.registrationKind === 'file') return target.manifestPath;
  return pathApi(target.platform).resolve(support.manifestDir, `${target.registrationId}.json`);
}

async function prepareLauncher({ support, platform, nodePath, nativeHostPath }) {
  const launcher = buildNativeHostLauncher({ nodePath, nativeHostPath, platform });
  await mkdir(support.supportDir, { recursive: true, ...(platform === 'win32' ? {} : { mode: 0o700 }) });
  if (platform !== 'win32') await chmod(support.supportDir, 0o700);
  await atomicWrite(support.launcherPath, launcher, 0o700, { platform });
  const readback = await readFile(support.launcherPath, 'utf8');
  if (readback !== launcher)
    throw installError('launcher_readback_mismatch', 'Native host launcher read-back mismatch');
  return launcher;
}

async function installRegistration({ target, support, platform, registryRunner }) {
  const manifestPath = targetManifestPath(target, support);
  const manifest = buildNativeHostManifest(target, support.launcherPath);
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600, { platform });
  const manifestReadback = await readJsonFile(manifestPath);
  if (!manifestReadback.value) throw installError('manifest_readback_failed', 'Native host manifest read-back failed');
  const validation = validateNativeHostManifest(target, manifestReadback.value, support.launcherPath);
  if (!validation.valid) {
    throw installError('manifest_readback_mismatch', 'Native host manifest read-back mismatch', {
      issues: validation.issues,
    });
  }
  if (target.registrationKind === 'registry') {
    await writeWindowsRegistryValue(target.registryKey, manifestPath, { registryRunner });
  }
  return { manifestPath, validation };
}

export async function installNativeHosts({
  browsers,
  extensionId,
  homeDir,
  localAppDataDir,
  xdgDataHome,
  env = process.env,
  platform = process.platform,
  nodePath = process.execPath,
  nativeHostPath = currentCliPackagePaths().nativeHostPath,
  registryRunner,
} = {}) {
  assertSupportedPlatform(platform);
  const requestedBrowsers = Array.isArray(browsers) ? browsers.filter(Boolean) : [];
  if (!requestedBrowsers.length)
    throw installError('browser_not_found', 'No supported browser was selected for installation');
  if (extensionId != null && requestedBrowsers.length !== 1) {
    throw installError('extension_id_requires_single_browser', 'Extension id override requires exactly one browser');
  }
  const support = resolveCliSupportPaths({ platform, homeDir, localAppDataDir, xdgDataHome, env });
  const targets = resolveRegistrationTargets(requestedBrowsers, {
    platform,
    homeDir,
    localAppDataDir,
    env,
    extensionId,
  });
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  await assertExecutableNode(node, platform);
  await assertNativeHostScript(host, platform);
  await prepareLauncher({ support, platform, nodePath: node, nativeHostPath: host });

  const registrations = [];
  for (const target of targets) {
    const installed = await installRegistration({ target, support, platform, registryRunner });
    registrations.push({
      registrationId: target.registrationId,
      registrationKind: target.registrationKind,
      sharedByBrowsers: [...target.sharedByBrowsers],
      productionIdentity: target.productionIdentity,
      extensionIds: [...target.extensionIds],
      manifestPath: installed.manifestPath,
      registryKey: target.registryKey,
    });
  }
  return {
    launcherPath: support.launcherPath,
    nativeHostPath: host,
    nodePath: node,
    registrations,
  };
}

export async function installNativeHost({
  browser,
  extensionId,
  homeDir,
  localAppDataDir,
  xdgDataHome,
  env = process.env,
  platform = process.platform,
  nodePath = process.execPath,
  nativeHostPath = currentCliPackagePaths().nativeHostPath,
  registryRunner,
} = {}) {
  const installed = await installNativeHosts({
    browsers: [browser],
    extensionId,
    homeDir,
    localAppDataDir,
    xdgDataHome,
    env,
    platform,
    nodePath,
    nativeHostPath,
    registryRunner,
  });
  const registration = installed.registrations[0];
  return {
    browser: String(browser || '')
      .trim()
      .toLowerCase(),
    registrationId: registration.registrationId,
    registrationKind: registration.registrationKind,
    sharedByBrowsers: registration.sharedByBrowsers,
    extensionIds: registration.extensionIds,
    productionIdentity: registration.productionIdentity,
    launcherPath: installed.launcherPath,
    manifestPath: registration.manifestPath,
    registryKey: registration.registryKey,
    nativeHostPath: installed.nativeHostPath,
    nodePath: installed.nodePath,
  };
}

async function registrationPresence(target, support, registryRunner) {
  const manifestPath = targetManifestPath(target, support);
  const manifestPresent = (await pathState(manifestPath)).present;
  if (target.registrationKind === 'file') return { present: manifestPresent, manifestPath };
  const registry = await queryWindowsRegistryValue(target.registryKey, { registryRunner });
  return { present: registry.present, manifestPresent, manifestPath, registryValue: registry.value };
}

export async function uninstallNativeHost({
  browser,
  homeDir,
  localAppDataDir,
  xdgDataHome,
  env = process.env,
  platform = process.platform,
  registryRunner,
} = {}) {
  assertSupportedPlatform(platform);
  const requestedBrowsers = browser ? [String(browser).trim().toLowerCase()] : listBrowserTargets({ platform });
  const options = { platform, homeDir, localAppDataDir, env };
  const targets = resolveRegistrationTargets(requestedBrowsers, options);
  const support = resolveCliSupportPaths({ platform, homeDir, localAppDataDir, xdgDataHome, env });
  const removedRegistrations = [];
  for (const target of targets) {
    const manifestPath = targetManifestPath(target, support);
    let registrationRemoved = false;
    if (target.registrationKind === 'registry') {
      registrationRemoved = await deleteWindowsRegistryValue(target.registryKey, { registryRunner });
    }
    const manifestRemoved = await removeExactFile(manifestPath);
    if (registrationRemoved || manifestRemoved) {
      removedRegistrations.push({
        requestedBrowsers: [...target.browsers],
        sharedByBrowsers: [...target.sharedByBrowsers],
        registrationId: target.registrationId,
        path: manifestPath,
        registryKey: target.registryKey,
      });
    }
  }

  const allTargets = resolveRegistrationTargets(listBrowserTargets({ platform }), options);
  const remaining = [];
  for (const target of allTargets) {
    const state = await registrationPresence(target, support, registryRunner);
    if (state.present) {
      remaining.push({
        sharedByBrowsers: [...target.sharedByBrowsers],
        registrationId: target.registrationId,
        path: state.manifestPath,
        registryKey: target.registryKey,
      });
    }
  }

  let launcherRemoved = false;
  if (remaining.length === 0) {
    launcherRemoved = await removeExactFile(support.launcherPath);
    try {
      await rmdir(support.manifestDir);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(String(error?.code || ''))) throw error;
    }
    try {
      await rmdir(support.supportDir);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(String(error?.code || ''))) throw error;
    }
  }

  return {
    requestedBrowsers,
    removedRegistrations,
    remainingRegistrations: remaining,
    launcherRemoved,
    launcherPath: support.launcherPath,
  };
}

async function inspectLauncher({ launcherPath, expectedLauncher, platform }) {
  const state = await pathState(launcherPath);
  if (!state.present) {
    return { path: launcherPath, ...state, executable: false, modeValid: false, matchesCurrentPackage: false };
  }
  let contents = '';
  try {
    contents = await readFile(launcherPath, 'utf8');
  } catch {
    // state below reports the mismatch
  }
  const isWindows = platform === 'win32';
  return {
    path: launcherPath,
    ...state,
    executable: isWindows ? state.regularFile && !state.symbolicLink : (state.mode & 0o111) !== 0,
    modeValid: isWindows ? state.regularFile && !state.symbolicLink : state.mode === 0o700,
    matchesCurrentPackage: state.regularFile && !state.symbolicLink && contents === expectedLauncher,
  };
}

async function inspectRegistration(target, support, registryRunner) {
  const manifestPath = targetManifestPath(target, support);
  const sharedByBrowsers = Array.isArray(target.sharedByBrowsers)
    ? [...target.sharedByBrowsers]
    : Array.isArray(target.browsers)
      ? [...target.browsers]
      : [target.browserId];
  const state = await pathState(manifestPath);
  let registry = null;
  if (target.registrationKind === 'registry') {
    registry = await queryWindowsRegistryValue(target.registryKey, { registryRunner });
  }
  if (!state.present) {
    return {
      registrationId: target.registrationId,
      sharedByBrowsers,
      registrationKind: target.registrationKind,
      path: manifestPath,
      registryKey: target.registryKey,
      present: registry?.present === true,
      valid: false,
      issues:
        registry?.present === true
          ? ['manifest_missing']
          : ['manifest_missing', ...(registry ? ['registry_missing'] : [])],
      productionIdentity: false,
      mode: null,
    };
  }
  const parsed = await readJsonFile(manifestPath);
  const validation = parsed.value
    ? validateNativeHostManifest(target, parsed.value, support.launcherPath)
    : { valid: false, issues: ['manifest_invalid_json'], productionIdentity: false };
  const issues = parsed.error ? ['manifest_invalid_json'] : [...validation.issues];
  if (target.platform !== 'win32' && state.mode !== 0o600) issues.push('manifest_mode');
  if (registry) {
    if (!registry.present) issues.push('registry_missing');
    else if (registry.value !== manifestPath) issues.push('registry_manifest_path');
  }
  return {
    registrationId: target.registrationId,
    sharedByBrowsers,
    registrationKind: target.registrationKind,
    path: manifestPath,
    registryKey: target.registryKey,
    present: target.registrationKind === 'registry' ? registry?.present === true : true,
    valid: validation.valid && (target.platform === 'win32' || state.mode === 0o600) && issues.length === 0,
    issues,
    productionIdentity: validation.productionIdentity,
    mode: state.mode,
    allowlist: parsed.value?.[target.allowlistField] ?? null,
  };
}

export async function inspectCliInstallation({
  homeDir,
  localAppDataDir,
  xdgDataHome,
  env = process.env,
  platform = process.platform,
  nodePath = process.execPath,
  nativeHostPath = currentCliPackagePaths().nativeHostPath,
  registryRunner,
  browserPathExists,
} = {}) {
  const platformSupported = SUPPORTED_PLATFORMS.has(platform);
  if (!platformSupported) {
    return {
      platform,
      platformSupported: false,
      package: {
        packageDir: currentCliPackagePaths().packageDir,
        packageJsonPath: currentCliPackagePaths().packageJsonPath,
        packagePresent: false,
        name: null,
        version: null,
        nodePath: String(nodePath || ''),
        nodePresent: false,
        nodeExecutable: false,
        nativeHostPath: String(nativeHostPath || ''),
        nativeHostPresent: false,
      },
      launcher: { path: null, present: false, executable: false, modeValid: false, matchesCurrentPackage: false },
      detectedBrowsers: [],
      registrations: [],
    };
  }
  const support = resolveCliSupportPaths({ platform, homeDir, localAppDataDir, xdgDataHome, env });
  const node = String(nodePath || '').trim();
  const host = String(nativeHostPath || '').trim();
  const expectedLauncher = buildNativeHostLauncher({ nodePath: node, nativeHostPath: host, platform });
  const [nodeState, hostState, launcher, packageJson] = await Promise.all([
    pathState(node),
    pathState(host),
    inspectLauncher({ launcherPath: support.launcherPath, expectedLauncher, platform }),
    readJsonFile(currentCliPackagePaths().packageJsonPath),
  ]);
  const detectedBrowsers = await discoverInstalledBrowsers({
    platform,
    homeDir,
    localAppDataDir,
    env,
    ...(browserPathExists ? { pathExists: browserPathExists } : null),
  });
  const registrationTargets = resolveRegistrationTargets(listBrowserTargets({ platform }), {
    platform,
    homeDir,
    localAppDataDir,
    env,
  });
  const detectedIds = new Set(detectedBrowsers.map((item) => item.id));
  const registrations = [];
  for (const target of registrationTargets) {
    const inspected = await inspectRegistration(target, support, registryRunner);
    const requiredByDetectedBrowser = target.browsers.some((browserId) => detectedIds.has(browserId));
    if (inspected.present || requiredByDetectedBrowser) registrations.push(inspected);
  }
  return {
    platform,
    platformSupported: true,
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
    detectedBrowsers,
    registrations,
  };
}

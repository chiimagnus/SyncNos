import { spawn } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CHROME_PRODUCTION_EXTENSION_ID,
  FIREFOX_PRODUCTION_EXTENSION_ID,
  NATIVE_HOST_MANIFEST_FILENAME,
  buildNativeHostManifest,
  resolveBrowserTarget,
} from '../../cli/browser-targets.mjs';
import {
  buildNativeHostLauncher,
  deleteWindowsRegistryValue,
  inspectCliInstallation,
  installNativeHost,
  queryWindowsRegistryValue,
  resolveCliSupportPaths,
  shellQuote,
  uninstallNativeHost,
  writeWindowsRegistryValue,
} from '../../cli/install.mjs';
import { NativeMessageParser, contract, encodeNativeMessage } from '../../cli/native-host.mjs';

async function tempHome() {
  return await mkdtemp(join(tmpdir(), 'syncnos-installer-home-'));
}

function mode(stat: Awaited<ReturnType<typeof lstat>>) {
  return stat.mode & 0o777;
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('macOS CLI native host installer', () => {
  it('pins production browser identities to the existing public/release owners', async () => {
    const repoRoot = join(import.meta.dirname, '../..');
    const [readme, releasePacker] = await Promise.all([
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, '.github/scripts/webclipper/package-release-assets.mjs'), 'utf8'),
    ]);
    expect(readme).toContain(CHROME_PRODUCTION_EXTENSION_ID);
    expect(releasePacker).toContain(FIREFOX_PRODUCTION_EXTENSION_ID);
  });

  it('resolves exact Chrome/Firefox production manifests and never mixes allowlist fields', async () => {
    const homeDir = await tempHome();
    const launcherPath = resolveCliSupportPaths({ homeDir }).launcherPath;
    const chrome = resolveBrowserTarget('chrome', { homeDir });
    const firefox = resolveBrowserTarget('firefox', { homeDir });

    expect(chrome.manifestPath).toBe(
      join(homeDir, 'Library/Application Support/Google/Chrome/NativeMessagingHosts', NATIVE_HOST_MANIFEST_FILENAME),
    );
    expect(firefox.manifestPath).toBe(
      join(homeDir, 'Library/Application Support/Mozilla/NativeMessagingHosts', NATIVE_HOST_MANIFEST_FILENAME),
    );
    expect(buildNativeHostManifest(chrome, launcherPath)).toEqual({
      name: contract.nativeHostName,
      description: 'SyncNos local CLI bridge',
      path: launcherPath,
      type: 'stdio',
      allowed_origins: [
        `chrome-extension://${CHROME_PRODUCTION_EXTENSION_ID}/`,
        'chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/',
      ],
    });
    expect(buildNativeHostManifest(firefox, launcherPath)).toEqual({
      name: contract.nativeHostName,
      description: 'SyncNos local CLI bridge',
      path: launcherPath,
      type: 'stdio',
      allowed_extensions: [FIREFOX_PRODUCTION_EXTENSION_ID],
    });
  });

  it('writes a fixed 0700 launcher and 0600 manifest, and repeat install deterministically replaces them', async () => {
    const homeDir = await tempHome();
    const first = await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    expect(mode(await lstat(first.launcherPath))).toBe(0o700);
    expect(mode(await lstat(first.manifestPath))).toBe(0o600);
    expect((await readFile(first.launcherPath, 'utf8')).startsWith('#!/bin/sh\nexec ')).toBe(true);
    expect(await readJson(first.manifestPath)).toEqual(
      buildNativeHostManifest(resolveBrowserTarget('chrome', { homeDir }), first.launcherPath),
    );

    const fakeDir = await mkdtemp(join(tmpdir(), "syncnos-upgrade-'"));
    const nextNode = join(fakeDir, "node-'next");
    const nextHost = join(fakeDir, "native-'host.mjs");
    await import('node:fs/promises').then(({ writeFile }) =>
      Promise.all([writeFile(nextNode, '#!/bin/sh\nexit 0\n'), writeFile(nextHost, '// next host\n')]),
    );
    await chmod(nextNode, 0o700);
    const second = await installNativeHost({
      browser: 'chrome',
      homeDir,
      platform: 'darwin',
      nodePath: nextNode,
      nativeHostPath: nextHost,
    });
    expect(second.launcherPath).toBe(first.launcherPath);
    expect(second.manifestPath).toBe(first.manifestPath);
    expect(await readFile(second.launcherPath, 'utf8')).toBe(
      buildNativeHostLauncher({ nodePath: nextNode, nativeHostPath: nextHost }),
    );
    expect(await readJson(second.manifestPath)).toMatchObject({ path: first.launcherPath });
  });

  it('keeps extension-id override local to the selected install target', async () => {
    const homeDir = await tempHome();
    const chromeOverride = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const chrome = await installNativeHost({
      browser: 'chrome',
      extensionId: chromeOverride,
      homeDir,
      platform: 'darwin',
    });
    const firefox = await installNativeHost({ browser: 'firefox', homeDir, platform: 'darwin' });
    expect((await readJson(chrome.manifestPath)).allowed_origins).toEqual([`chrome-extension://${chromeOverride}/`]);
    expect((await readJson(firefox.manifestPath)).allowed_extensions).toEqual([FIREFOX_PRODUCTION_EXTENSION_ID]);
  });

  it('uninstalls exact selected manifests and only removes the shared launcher after the final browser', async () => {
    const homeDir = await tempHome();
    const chrome = await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    const firefox = await installNativeHost({ browser: 'firefox', homeDir, platform: 'darwin' });

    const chromeRemoved = await uninstallNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    expect(chromeRemoved.removedRegistrations).toEqual([
      expect.objectContaining({ browser: 'chrome', registrationId: 'chrome', path: chrome.manifestPath }),
    ]);
    expect(chromeRemoved.launcherRemoved).toBe(false);
    await expect(lstat(chrome.launcherPath)).resolves.toBeTruthy();
    await expect(lstat(firefox.manifestPath)).resolves.toBeTruthy();

    const firefoxRemoved = await uninstallNativeHost({ browser: 'firefox', homeDir, platform: 'darwin' });
    expect(firefoxRemoved.launcherRemoved).toBe(true);
    await expect(lstat(firefox.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(resolveCliSupportPaths({ homeDir }).supportDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uninstall without --browser removes every declared browser manifest and then the shared launcher', async () => {
    const homeDir = await tempHome();
    const chrome = await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    const firefox = await installNativeHost({ browser: 'firefox', homeDir, platform: 'darwin' });
    const removed = await uninstallNativeHost({ homeDir, platform: 'darwin' });
    expect(removed.browsers).toEqual(expect.arrayContaining(['chrome', 'firefox']));
    expect(removed.removedRegistrations.map((item) => item.browser)).toEqual(['chrome', 'firefox']);
    expect(removed.remainingRegistrations).toEqual([]);
    expect(removed.launcherRemoved).toBe(true);
    await expect(lstat(chrome.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(firefox.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(chrome.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('inspects schema/allowlist/package state without requiring an online extension endpoint', async () => {
    const homeDir = await tempHome();
    await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    const inspection = await inspectCliInstallation({
      homeDir,
      platform: 'darwin',
      browserPathExists: async () => false,
    });
    expect(inspection.platformSupported).toBe(true);
    expect(inspection.package).toMatchObject({
      name: 'syncnos-cli',
      nodePresent: true,
      nodeExecutable: true,
      nativeHostPresent: true,
    });
    expect(inspection.launcher).toMatchObject({
      present: true,
      executable: true,
      modeValid: true,
      matchesCurrentPackage: true,
      mode: 0o700,
    });
    expect(inspection.registrations.find((item) => item.registrationId === 'chrome')).toMatchObject({
      present: true,
      valid: true,
      productionIdentity: true,
      mode: 0o600,
    });
    expect(inspection.registrations.map((item) => item.registrationId)).toEqual(['chrome']);
  });

  it('fails closed for relative launcher inputs and reports non-canonical file modes', async () => {
    const homeDir = await tempHome();
    const chrome = resolveBrowserTarget('chrome', { homeDir });
    expect(() => buildNativeHostManifest(chrome, 'relative/native-host')).toThrow(/must be absolute/);
    await expect(
      installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin', nodePath: 'node' }),
    ).rejects.toMatchObject({ code: 'node_path_invalid' });

    const installed = await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    await chmod(installed.launcherPath, 0o755);
    await chmod(installed.manifestPath, 0o644);
    const inspection = await inspectCliInstallation({
      homeDir,
      platform: 'darwin',
      browserPathExists: async () => false,
    });
    expect(inspection.launcher).toMatchObject({ mode: 0o755, modeValid: false });
    expect(inspection.registrations.find((item) => item.registrationId === 'chrome')).toMatchObject({
      valid: false,
      mode: 0o644,
      issues: expect.arrayContaining(['manifest_mode']),
    });
  });

  it('installs and uninstalls a Linux user-level manifest under XDG config/data roots', async () => {
    const homeDir = await tempHome();
    const xdgDataHome = join(homeDir, 'xdg-data');
    const env = { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, 'xdg-config') };
    const installed = await installNativeHost({
      browser: 'brave',
      homeDir,
      xdgDataHome,
      env,
      platform: 'linux',
    });
    expect(installed.manifestPath).toBe(
      join(homeDir, 'xdg-config/BraveSoftware/Brave-Browser/NativeMessagingHosts', NATIVE_HOST_MANIFEST_FILENAME),
    );
    expect(installed.launcherPath).toBe(join(xdgDataHome, 'SyncNos/cli/native-host'));
    expect(mode(await lstat(installed.launcherPath))).toBe(0o700);
    expect(mode(await lstat(installed.manifestPath))).toBe(0o600);
    expect(await readJson(installed.manifestPath)).toEqual(
      buildNativeHostManifest(
        resolveBrowserTarget('brave', { platform: 'linux', homeDir, env }),
        installed.launcherPath,
      ),
    );

    const inspection = await inspectCliInstallation({ homeDir, xdgDataHome, env, platform: 'linux' });
    expect(inspection.platformSupported).toBe(true);
    expect(inspection.registrations.find((item) => item.registrationId === 'brave')).toMatchObject({
      present: true,
      valid: true,
      registrationId: 'brave',
    });

    const removed = await uninstallNativeHost({ browser: 'brave', homeDir, xdgDataHome, env, platform: 'linux' });
    expect(removed.launcherRemoved).toBe(true);
    await expect(lstat(installed.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(installed.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('builds a Windows batch launcher with absolute paths and escapes percent expansion', () => {
    const support = resolveCliSupportPaths({
      platform: 'win32',
      homeDir: 'C:\\Users\\example',
      localAppDataDir: 'C:\\Users\\example\\AppData\\Local',
    });
    expect(support).toMatchObject({
      supportDir: 'C:\\Users\\example\\AppData\\Local\\SyncNos\\cli',
      launcherPath: 'C:\\Users\\example\\AppData\\Local\\SyncNos\\cli\\native-host.bat',
      manifestDir: 'C:\\Users\\example\\AppData\\Local\\SyncNos\\cli\\manifests',
    });
    const launcher = buildNativeHostLauncher({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\Node 100%\\node.exe',
      nativeHostPath: 'C:\\Users\\example\\SyncNos\\native-host.mjs',
    });
    expect(launcher).toContain('setlocal DisableDelayedExpansion');
    expect(launcher).toContain('"C:\\Program Files\\Node 100%%\\node.exe"');
    expect(launcher).toContain('"C:\\Users\\example\\SyncNos\\native-host.mjs" %*');
    expect(launcher).toContain('exit /b %errorlevel%');
  });

  it('writes, queries and deletes only the exact Windows HKCU registration key', async () => {
    const values = new Map<string, string>();
    const calls: Array<{ executable: string; args: string[] }> = [];
    const registryRunner = async (executable: string, args: string[]) => {
      calls.push({ executable, args: [...args] });
      const operation = args[0];
      const key = args[1];
      if (operation === 'QUERY') {
        const value = values.get(key);
        return value
          ? { status: 0, stdout: `HKEY_CURRENT_USER\\...\r\n    (Default)    REG_SZ    ${value}\r\n`, stderr: '' }
          : { status: 1, stdout: '', stderr: 'not found' };
      }
      if (operation === 'ADD') {
        const valueIndex = args.indexOf('/d');
        values.set(key, args[valueIndex + 1]);
        return { status: 0, stdout: 'ok', stderr: '' };
      }
      if (operation === 'DELETE') {
        values.delete(key);
        return { status: 0, stdout: 'ok', stderr: '' };
      }
      return { status: 2, stdout: '', stderr: 'unexpected' };
    };
    const key = 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\app.syncnos.cli';
    const manifestPath = 'C:\\Users\\example\\AppData\\Local\\SyncNos\\cli\\manifests\\edge.json';

    await expect(writeWindowsRegistryValue(key, manifestPath, { registryRunner })).resolves.toEqual({
      present: true,
      value: manifestPath,
    });
    await expect(queryWindowsRegistryValue(key, { registryRunner })).resolves.toEqual({
      present: true,
      value: manifestPath,
    });
    await expect(deleteWindowsRegistryValue(key, { registryRunner })).resolves.toBe(true);
    await expect(queryWindowsRegistryValue(key, { registryRunner })).resolves.toEqual({ present: false, value: null });
    expect(calls.filter((call) => call.args[0] === 'ADD')).toEqual([
      {
        executable: 'reg.exe',
        args: ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
      },
    ]);
    expect(calls.filter((call) => call.args[0] === 'DELETE')).toEqual([
      { executable: 'reg.exe', args: ['DELETE', key, '/f'] },
    ]);
  });

  it('decodes UTF-16LE Windows Registry read-back without corrupting Unicode manifest paths', async () => {
    const key = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\app.syncnos.cli';
    const manifestPath = 'C:\\Users\\测试用户\\AppData\\Local\\SyncNos\\cli\\manifests\\mozilla.json';
    const registryRunner = async () => ({
      status: 0,
      stdout: Buffer.from(`HKEY_CURRENT_USER\\...\r\n    (Default)    REG_SZ    ${manifestPath}\r\n`, 'utf16le'),
      stderr: Buffer.alloc(0),
    });
    await expect(queryWindowsRegistryValue(key, { registryRunner })).resolves.toEqual({
      present: true,
      value: manifestPath,
    });
  });

  it('uses shell-safe absolute paths and launches with an empty PATH', async () => {
    expect(shellQuote("/tmp/a'b")).toBe("'/tmp/a'\"'\"'b'");
    const homeDir = await tempHome();
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'syncnos-installer-runtime-'));
    const installed = await installNativeHost({ browser: 'chrome', homeDir, platform: 'darwin' });
    const child = spawn(installed.launcherPath, [], {
      env: { ...process.env, HOME: homeDir, PATH: '', TMPDIR: runtimeRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parser = new NativeMessageParser();
    const messages: any[] = [];
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    const gotAck = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('native host hello timeout')), 3000);
      child.stdout.on('data', (chunk) => {
        try {
          messages.push(...parser.push(chunk));
          if (messages.length) {
            clearTimeout(timer);
            resolve();
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
    child.stdin.write(encodeNativeMessage({ kind: contract.frames.hello, protocolVersion: contract.protocolVersion }));
    await gotAck;
    expect(messages[0]).toMatchObject({ kind: contract.frames.helloAck, ok: true });
    expect(stderr).toBe('');
    child.stdin.end();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  });
});

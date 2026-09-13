import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  clearPreferredInstance,
  readUserConfig,
  setPreferredInstance,
  userConfigPaths,
} from '../../cli/user-config.mjs';

describe('CLI user config', () => {
  it('persists only the preferred instance in a private atomic config', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'syncnos-home-'));
    await expect(readUserConfig({ homeDir })).resolves.toEqual({ preferredCliInstanceId: null });
    await setPreferredInstance('instance-main', { homeDir });
    await expect(readUserConfig({ homeDir })).resolves.toEqual({ preferredCliInstanceId: 'instance-main' });

    const path = userConfigPaths.configPath({ homeDir });
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    const raw = JSON.parse(await readFile(path, 'utf8'));
    expect(raw).toEqual({ preferredCliInstanceId: 'instance-main' });
    expect(JSON.stringify(raw)).not.toMatch(/endpoint|url|token|secret/i);

    await clearPreferredInstance({ homeDir });
    await expect(readUserConfig({ homeDir })).resolves.toEqual({ preferredCliInstanceId: null });
  });

  it('uses the Linux XDG data root instead of the macOS Application Support path', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'syncnos-linux-home-'));
    const xdgDataHome = join(homeDir, 'data');
    const options = { platform: 'linux' as const, homeDir, xdgDataHome, env: { HOME: homeDir } };
    expect(userConfigPaths.configPath(options)).toBe(join(xdgDataHome, 'SyncNos/cli/config.json'));
    await setPreferredInstance('linux-instance', options);
    await expect(readUserConfig(options)).resolves.toEqual({ preferredCliInstanceId: 'linux-instance' });
    expect((await lstat(userConfigPaths.configPath(options))).mode & 0o777).toBe(0o600);
  });

  it('uses LOCALAPPDATA for the Windows config path', () => {
    expect(
      userConfigPaths.configPath({
        platform: 'win32',
        homeDir: 'C:\\Users\\example',
        localAppDataDir: 'C:\\Users\\example\\AppData\\Local',
      }),
    ).toBe('C:\\Users\\example\\AppData\\Local\\SyncNos\\cli\\config.json');
  });
});

import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DARWIN_UNIX_SOCKET_PATH_MAX_BYTES,
  ensureRuntimeDir,
  readRegistryEntry,
  registryPathForInstance,
  removeRegistryEntryIfOwned,
  socketPathForInstance,
  validatePrivateDirectoryStat,
  writeRegistryEntry,
} from '../../cli/runtime-registry.mjs';

async function tempRoot(prefix = 'syncnos-registry-') {
  return await mkdtemp(join(tmpdir(), prefix));
}

describe('CLI runtime registry', () => {
  it('creates a user-private runtime directory and short deterministic socket path', async () => {
    const root = await mkdtemp('/tmp/snr-');
    const runtimeDir = await ensureRuntimeDir({ root });
    const stat = await lstat(runtimeDir);
    expect(stat.mode & 0o777).toBe(0o700);
    const first = socketPathForInstance(runtimeDir, '11111111-1111-4111-8111-111111111111');
    const second = socketPathForInstance(runtimeDir, '11111111-1111-4111-8111-111111111111');
    expect(first).toBe(second);
    expect(first).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(DARWIN_UNIX_SOCKET_PATH_MAX_BYTES);

    const realTmpRuntime = join(tmpdir(), `sn-${process.getuid?.() ?? 0}`);
    const realTmpSocket = socketPathForInstance(realTmpRuntime, '22222222-2222-4222-8222-222222222222');
    expect(Buffer.byteLength(realTmpSocket)).toBeLessThanOrEqual(DARWIN_UNIX_SOCKET_PATH_MAX_BYTES);
  });

  it('fails closed for symlink and non-directory runtime paths', async () => {
    const root = await tempRoot();
    const uid = process.getuid?.() ?? 0;
    const target = join(root, 'target');
    await mkdir(target);
    await symlink(target, join(root, `sn-${uid}`));
    await expect(ensureRuntimeDir({ root, uid })).rejects.toMatchObject({ code: 'runtime_dir_symlink' });

    const root2 = await tempRoot();
    await writeFile(join(root2, `sn-${uid}`), 'not a directory');
    await expect(ensureRuntimeDir({ root: root2, uid })).rejects.toMatchObject({ code: 'runtime_dir_not_directory' });
  });

  it('rejects a directory owned by another uid before any reuse', () => {
    const fakeStat = {
      uid: 999999,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    expect(() => validatePrivateDirectoryStat(fakeStat as any, 501)).toThrowError(
      expect.objectContaining({ code: 'runtime_dir_wrong_owner' }),
    );
  });

  it('atomically writes registry entries as 0600 and removes only the matching process nonce', async () => {
    const root = await tempRoot();
    const runtimeDir = await ensureRuntimeDir({ root });
    const path = registryPathForInstance(runtimeDir, 'instance-a');
    const entry = {
      cliInstanceId: 'instance-a',
      endpoint: socketPathForInstance(runtimeDir, 'instance-a'),
      processNonce: 'nonce-a',
    };
    await writeRegistryEntry(path, entry);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(entry);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await expect(removeRegistryEntryIfOwned(path, 'nonce-b')).resolves.toBe(false);
    await expect(readRegistryEntry(path)).resolves.toEqual(entry);
    await expect(removeRegistryEntryIfOwned(path, 'nonce-a')).resolves.toBe(true);
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('re-converges an existing runtime directory mode to 0700', async () => {
    const root = await tempRoot();
    const uid = process.getuid?.() ?? 0;
    const path = join(root, `sn-${uid}`);
    await mkdir(path, { mode: 0o755 });
    await chmod(path, 0o755);
    await ensureRuntimeDir({ root, uid });
    expect((await lstat(path)).mode & 0o777).toBe(0o700);
  });
});

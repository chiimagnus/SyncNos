import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_DATA_PROTOCOL_VERSION, LOCAL_DATA_SCHEMA_VERSION } from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';

import { openReadOnly } from '../../packages/syncnoscli/src/sqlite/database';
import { encodeNativeMessage, readNativeMessages } from '../../packages/syncnoscli/src/native-host/stdio';
import { ensureNativeHostLauncher } from '../../packages/syncnoscli/src/runtime/launcher';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const packageRoot = resolve(__dirname, '../../packages/syncnoscli');
const temporaryRoots: string[] = [];

async function decodeNativeMessages(bytes: Uint8Array): Promise<unknown[]> {
  async function* stream(): AsyncGenerator<Uint8Array> {
    yield bytes;
  }

  const messages: unknown[] = [];
  for await (const message of readNativeMessages(stream())) messages.push(message);
  return messages;
}

function waitForClose(
  child: ChildProcessWithoutNullStreams,
): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>> {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill();
      rejectExit(new Error('Windows Native Host shim did not exit after the browser pipe disconnected.'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function runShimDisconnect(paths: ReturnType<typeof resolveSyncNosRuntimePaths>): Promise<{
  exit: Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;
  messages: unknown[];
  stderr: string;
}> {
  const child = spawn(paths.launcherPath, [nativeHostContract.browsers.chrome.origin, '--parent-window=0'], {
    shell: false,
    stdio: 'pipe',
    windowsHide: true,
  });
  const stderr: Buffer[] = [];
  const stdout: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
  child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
  child.stdin.on('error', () => undefined);
  const exit = waitForClose(child);
  child.stdin.end(
    Buffer.from(
      encodeNativeMessage({
        command: 'IMPORT_FACTS',
        payload: {
          migrationId: '2f964287-f0d4-45b8-9f0a-95bfcf7a0c1f',
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        },
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        requestId: 'windows-shim-disconnect',
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      }),
    ),
  );
  return {
    exit: await exit,
    messages: await decodeNativeMessages(Buffer.concat(stdout)),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Windows Native Host shim runtime', () => {
  const runOnWindows = process.platform === 'win32' ? it : it.skip;

  runOnWindows('forwards binary frames to Node and exits with its child after stdin disconnects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-windows-host-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root, platform: 'win32' });
    await ensureNativeHostLauncher({ packageRoot, paths });

    const result = await runShimDisconnect(paths);

    expect(result.exit).toEqual({ code: 1, signal: null });
    expect(result.stderr).toBe('');
    expect(result.messages).toMatchObject([
      { data: { accepted: true }, ok: true, requestId: 'windows-shim-disconnect' },
      { error: { code: 'MIGRATION_VALIDATION_FAILED' }, ok: false, requestId: 'windows-shim-disconnect' },
    ]);
    const handle = await openReadOnly({ paths });
    try {
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM staging_metadata').get()).toEqual({ count: 0 });
    } finally {
      handle.close();
    }
  });
});

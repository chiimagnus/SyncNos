import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileMocks = vi.hoisted(() => ({
  prepareMarkdownExport: vi.fn(),
  prepareJsonExport: vi.fn(),
  prepareBackupExport: vi.fn(),
  importBackupBlob: vi.fn(),
}));

vi.mock('@services/cli/file-operations', () => ({
  prepareMarkdownExport: (...args: unknown[]) => fileMocks.prepareMarkdownExport(...args),
  prepareJsonExport: (...args: unknown[]) => fileMocks.prepareJsonExport(...args),
  prepareBackupExport: (...args: unknown[]) => fileMocks.prepareBackupExport(...args),
  importBackupBlob: (...args: unknown[]) => fileMocks.importBackupBlob(...args),
}));

import { startCliNativeBridge } from '@services/cli/native-bridge';
import { contract, createNativeHostProtocol } from '../../cli/native-host.mjs';

function linkedBridge() {
  let extensionMessageListener: ((message: unknown) => void) | null = null;
  let extensionDisconnectListener: (() => void) | null = null;
  let host: ReturnType<typeof createNativeHostProtocol>;

  const port = {
    postMessage(message: unknown) {
      queueMicrotask(() => {
        void host.handleMessage(message);
      });
    },
    disconnect() {
      extensionDisconnectListener?.();
    },
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        extensionMessageListener = listener;
      },
    },
    onDisconnect: {
      addListener(listener: () => void) {
        extensionDisconnectListener = listener;
      },
    },
  };

  host = createNativeHostProtocol({
    write: async (frame: unknown) => {
      extensionMessageListener?.(frame);
    },
    requestTimeoutMs: 1000,
  });

  const controller = startCliNativeBridge(
    { dispatch: vi.fn(async () => ({ ok: true, data: {}, error: null })) } as any,
    {
      connectNativeHost: () => port as any,
      readExtensionRuntimeMetadata: () => ({
        runtimeId: 'runtime-roundtrip',
        extensionVersion: '1.2.3',
        browserFamily: 'chromium',
      }),
      readCliIntegrationStatus: vi.fn(async () => ({ available: true, enabled: true, permissionGranted: true })),
      getCliInstanceId: vi.fn(async () => 'roundtrip-instance'),
      disableCliIntegrationAfterPermissionRemoval: vi.fn(async () => {}),
      storageOnChanged: () => () => {},
      permissionsOnRemoved: () => () => {},
    },
  );

  return { host, controller };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CLI file transfer host/extension roundtrip', () => {
  it('round-trips extension export bytes to a host file using the canonical frame contract', async () => {
    const dir = await mkdtemp('/tmp/syncnos-roundtrip-');
    const outputPath = join(dir, 'selected.zip');
    const payload = new TextEncoder().encode('roundtrip-export');
    fileMocks.prepareMarkdownExport.mockResolvedValue({
      blob: new Blob([payload]),
      suggestedFilename: 'selected.zip',
      metadata: { format: 'markdown', conversationCount: 1 },
    });

    const linked = linkedBridge();
    try {
      await vi.waitFor(() => expect(linked.host.isReady()).toBe(true));
      const result = await linked.host.requestFileExport(
        'export.markdown',
        { conversationIds: [7] },
        { outputPath, timeoutMs: 1000 },
      );
      expect(result).toMatchObject({
        ok: true,
        data: { format: 'markdown', conversationCount: 1, path: outputPath, byteSize: payload.length },
      });
      expect(await readFile(outputPath)).toEqual(Buffer.from(payload));
      expect(fileMocks.prepareMarkdownExport).toHaveBeenCalledWith([7]);
    } finally {
      linked.controller.stop();
      linked.host.close();
    }
  });

  it('round-trips a host backup file into the extension importer without host-side ZIP interpretation', async () => {
    const dir = await mkdtemp('/tmp/syncnos-roundtrip-');
    const inputPath = join(dir, 'restore.zip');
    const payload = Buffer.from('opaque-zip-payload');
    await writeFile(inputPath, payload);
    fileMocks.importBackupBlob.mockImplementation(async (blob: Blob) => {
      expect(Buffer.from(await blob.arrayBuffer())).toEqual(payload);
      return { conversationsAdded: 2, messagesAdded: 3 };
    });

    const linked = linkedBridge();
    try {
      await vi.waitFor(() => expect(linked.host.isReady()).toBe(true));
      const result = await linked.host.requestFileImport('backup.import', {}, { inputPath, timeoutMs: 1000 });
      expect(result).toMatchObject({
        ok: true,
        data: { path: inputPath, byteSize: payload.length, conversationsAdded: 2, messagesAdded: 3 },
      });
      expect(fileMocks.importBackupBlob).toHaveBeenCalledTimes(1);
      expect(contract.fileTransfer.chunkBytes).toBe(256 * 1024);
    } finally {
      linked.controller.stop();
      linked.host.close();
    }
  });
});

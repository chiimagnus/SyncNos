import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
  buildMarkdown: vi.fn(),
  buildJson: vi.fn(),
  exportBackupZip: vi.fn(),
  extractZipEntries: vi.fn(),
  importBackupZipMerge: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  getConversationById: (...args: unknown[]) => mocks.getConversationById(...args),
  getConversationDetail: (...args: unknown[]) => mocks.getConversationDetail(...args),
}));
vi.mock('@services/sync/local/markdown-export', () => ({
  buildConversationsMarkdownZipExport: (...args: unknown[]) => mocks.buildMarkdown(...args),
}));
vi.mock('@services/sync/local/json-export', () => ({
  buildConversationsJsonZipExport: (...args: unknown[]) => mocks.buildJson(...args),
}));
vi.mock('@services/sync/backup/export', () => ({
  exportBackupZip: (...args: unknown[]) => mocks.exportBackupZip(...args),
}));
vi.mock('@services/sync/backup/zip-utils', () => ({
  extractZipEntries: (...args: unknown[]) => mocks.extractZipEntries(...args),
}));
vi.mock('@services/sync/backup/import', () => ({
  importBackupZipMerge: (...args: unknown[]) => mocks.importBackupZipMerge(...args),
}));

import {
  CliFileOperationError,
  importBackupBlob,
  prepareBackupExport,
  prepareJsonExport,
  prepareMarkdownExport,
} from '@services/cli/file-operations';

function conversation(id: number) {
  return { id, source: 'chatgpt', sourceType: 'chat', conversationKey: `c-${id}`, title: `Chat ${id}` } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversationById.mockImplementation(async (id: number) => conversation(id));
  mocks.buildMarkdown.mockResolvedValue({ zipBlob: new Blob(['md']), filename: 'md.zip' });
  mocks.buildJson.mockResolvedValue({ zipBlob: new Blob(['json']), filename: 'json.zip' });
  mocks.exportBackupZip.mockResolvedValue({
    blob: new Blob(['backup']),
    filename: 'backup.zip',
    exportedAt: '2026-09-13T00:00:00.000Z',
    counts: { conversations: 2 },
    warnings: [],
  });
  mocks.extractZipEntries.mockResolvedValue(new Map([['manifest.json', Uint8Array.of(1)]]));
  mocks.importBackupZipMerge.mockResolvedValue({ conversationsAdded: 1 });
});

describe('CLI file operations', () => {
  it('validates every explicit conversation id before starting Markdown generation and injects the direct detail loader', async () => {
    mocks.getConversationById.mockImplementation(async (id: number) => (id === 2 ? null : conversation(id)));

    await expect(prepareMarkdownExport([1, 2, 3])).rejects.toMatchObject({
      code: 'conversation_not_found',
      extra: { conversationId: 2 },
    });
    expect(mocks.getConversationById.mock.calls.map(([id]) => id)).toEqual([1, 2, 3]);
    expect(mocks.buildMarkdown).not.toHaveBeenCalled();

    mocks.getConversationById.mockImplementation(async (id: number) => conversation(id));
    const result = await prepareMarkdownExport([1, 3]);
    expect(result).toMatchObject({
      suggestedFilename: 'md.zip',
      metadata: { format: 'markdown', conversationCount: 2 },
    });
    expect(mocks.buildMarkdown).toHaveBeenCalledWith({
      conversations: [conversation(1), conversation(3)],
      loadConversationDetail: expect.any(Function),
    });
    const loader = mocks.buildMarkdown.mock.calls[0]?.[0]?.loadConversationDetail;
    await loader(1);
    expect(mocks.getConversationDetail).toHaveBeenCalledWith(1);
  });

  it('uses the same prevalidation/direct-loader boundary for JSON without changing public JSON schema v2 metadata', async () => {
    const result = await prepareJsonExport([4]);
    expect(result).toMatchObject({
      suggestedFilename: 'json.zip',
      metadata: { format: 'json', schemaVersion: 2, conversationCount: 1 },
    });
    expect(mocks.buildJson).toHaveBeenCalledWith({
      conversations: [conversation(4)],
      loadConversationDetail: expect.any(Function),
    });
  });

  it('fails malformed ids before any read or generation', async () => {
    for (const ids of [[], [0], [1.5], ['1']] as unknown[]) {
      await expect(prepareJsonExport(ids)).rejects.toBeInstanceOf(CliFileOperationError);
    }
    expect(mocks.buildJson).not.toHaveBeenCalled();
  });

  it('exposes backup export metadata without interpreting the ZIP in the host layer', async () => {
    const result = await prepareBackupExport();
    expect(result).toMatchObject({
      suggestedFilename: 'backup.zip',
      metadata: {
        format: 'backup',
        exportedAt: '2026-09-13T00:00:00.000Z',
        counts: { conversations: 2 },
        warnings: [],
      },
    });
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('imports a received Blob through extractZipEntries and the canonical merge service', async () => {
    const blob = new Blob(['zip']);
    await expect(importBackupBlob(blob)).resolves.toEqual({ conversationsAdded: 1 });
    expect(mocks.extractZipEntries).toHaveBeenCalledWith(blob);
    expect(mocks.importBackupZipMerge).toHaveBeenCalledWith(expect.any(Map));

    await expect(importBackupBlob(new Blob([]))).rejects.toMatchObject({ code: 'backup_file_empty' });
  });
});

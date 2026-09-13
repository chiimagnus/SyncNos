import { getConversationById, getConversationDetail } from '@services/conversations/data/storage';
import type { Conversation } from '@services/conversations/domain/models';
import { exportBackupZip } from '@services/sync/backup/export';
import { importBackupZipMerge } from '@services/sync/backup/import';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { buildConversationsJsonZipExport } from '@services/sync/local/json-export';
import { buildConversationsMarkdownZipExport } from '@services/sync/local/markdown-export';

export class CliFileOperationError extends Error {
  code: string;
  extra: Record<string, unknown> | null;

  constructor(code: string, message: string, extra: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CliFileOperationError';
    this.code = code;
    this.extra = extra;
  }
}

export type PreparedCliExport = {
  blob: Blob;
  suggestedFilename: string;
  metadata: Record<string, unknown>;
};

function normalizeConversationIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliFileOperationError('conversation_ids_required', 'At least one conversation id is required');
  }
  return value.map((raw) => {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
      throw new CliFileOperationError('invalid_conversation_id', 'Invalid conversation id');
    }
    return raw;
  });
}

async function loadConversationsOrThrow(value: unknown): Promise<Conversation[]> {
  const conversationIds = normalizeConversationIds(value);
  const conversations = await Promise.all(conversationIds.map((conversationId) => getConversationById(conversationId)));
  for (let index = 0; index < conversationIds.length; index += 1) {
    if (conversations[index]) continue;
    const conversationId = conversationIds[index]!;
    throw new CliFileOperationError('conversation_not_found', 'Conversation not found', { conversationId });
  }
  return conversations as Conversation[];
}

export async function prepareMarkdownExport(conversationIds: unknown): Promise<PreparedCliExport> {
  const conversations = await loadConversationsOrThrow(conversationIds);
  const result = await buildConversationsMarkdownZipExport({
    conversations,
    loadConversationDetail: getConversationDetail,
  });
  return {
    blob: result.zipBlob,
    suggestedFilename: result.filename,
    metadata: { format: 'markdown', conversationCount: conversations.length },
  };
}

export async function prepareJsonExport(conversationIds: unknown): Promise<PreparedCliExport> {
  const conversations = await loadConversationsOrThrow(conversationIds);
  const result = await buildConversationsJsonZipExport({
    conversations,
    loadConversationDetail: getConversationDetail,
  });
  return {
    blob: result.zipBlob,
    suggestedFilename: result.filename,
    metadata: { format: 'json', schemaVersion: 2, conversationCount: conversations.length },
  };
}

export async function prepareBackupExport(): Promise<PreparedCliExport> {
  const result = await exportBackupZip();
  return {
    blob: result.blob,
    suggestedFilename: result.filename,
    metadata: {
      format: 'backup',
      exportedAt: result.exportedAt,
      counts: result.counts,
      warnings: result.warnings,
    },
  };
}

export async function importBackupBlob(blob: Blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new CliFileOperationError('backup_file_empty', 'Backup file is empty');
  }
  const entries = await extractZipEntries(blob);
  return await importBackupZipMerge(entries);
}

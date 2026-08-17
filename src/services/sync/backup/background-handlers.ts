import { connectNative } from '@platform/local-data/native-client';
import { UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGetAll, storageSet } from '@platform/storage/local';
import type { BackgroundStreamHandler } from '@services/local-data/background-stream-router';
import { LocalDataContractError, parseJsonValue, parseStreamDescriptor } from '@services/local-data/contracts';
import { FactsBackend } from '@services/local-data/facts-backend';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import {
  LAST_BACKUP_EXPORT_AT_STORAGE_KEY,
  filterStorageForBackup,
  filterStorageForBackupImport,
} from '@services/sync/backup/backup-utils';
import { buildBackupZipV2 } from '@services/sync/backup/export';
import { createIdbBackupFactsAdapter } from '@services/sync/backup/idb-facts-adapter';
import { parseBackupLegacyJson, parseBackupZipV2 } from '@services/sync/backup/import';
import {
  backupBytesForBlob,
  decodeBackupPortableExport,
  encodeBackupPortableFacts,
  parseImportStats,
  type BackupFactsAdapter,
} from '@services/sync/backup/local-data';
import { extractZipEntries } from '@services/sync/backup/zip-utils';

type BackupStreamRouter = Readonly<{
  register: (operation: 'zip-backup', handler: BackgroundStreamHandler) => void;
}>;

type BackupRouter = Readonly<{
  eventsHub?: Readonly<{ broadcast: (type: string, payload: unknown) => void }>;
}>;

function isZipBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

function createNativeBackupFactsAdapter(lease: FactsOperationLease): BackupFactsAdapter {
  assertFactsOperationLease(lease);
  return Object.freeze({
    exportFacts: async () => {
      assertFactsOperationLease(lease);
      const bytes = await connectNative<Uint8Array>({
        command: 'EXPORT_BACKUP',
        payload: { transfer: { operation: 'zip-backup', declaredTotalBytes: 0 } },
      });
      assertFactsOperationLease(lease);
      return decodeBackupPortableExport(bytes);
    },
    importFacts: async (facts) => {
      assertFactsOperationLease(lease);
      const bytes = encodeBackupPortableFacts(facts);
      const transfer = parseStreamDescriptor({ operation: 'zip-backup', declaredTotalBytes: bytes.byteLength }, [
        'zip-backup',
      ]);
      const result = await connectNative<unknown>({
        command: 'IMPORT_BACKUP',
        payload: { transfer },
        uploadBytes: bytes,
      });
      assertFactsOperationLease(lease);
      return parseImportStats(result);
    },
  });
}

function createBackupFactsBackend(): FactsBackend<BackupFactsAdapter> {
  return new FactsBackend<BackupFactsAdapter>({
    createIdbRepository: (lease) => createIdbBackupFactsAdapter(lease),
    createNativeRepository: (lease) => createNativeBackupFactsAdapter(lease),
  });
}

async function parseIncomingBackup(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  if (isZipBytes(bytes)) {
    const entries = await extractZipEntries(new Blob([backupBytesForBlob(bytes)], { type: 'application/zip' }));
    return parseBackupZipV2(entries);
  }
  try {
    return parseBackupLegacyJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof LocalDataContractError) throw error;
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
}

/** Registers the sole UI-facing backup facts boundary. The stream router owns the outer gate lease. */
export function registerBackupHandlers(
  router: BackupRouter,
  dependencies: Readonly<{
    streamRouter: BackupStreamRouter;
    factsBackend?: FactsBackend<BackupFactsAdapter>;
  }>,
): void {
  const factsBackend = dependencies.factsBackend ?? createBackupFactsBackend();
  dependencies.streamRouter.register('zip-backup', {
    authorizeUpload: ({ stream }) => {
      const parsed = parseStreamDescriptor(stream, ['zip-backup']);
      if (parsed.declaredTotalBytes <= 0) throw new LocalDataContractError('INVALID_ARGUMENT');
    },
    download: async ({ lease, send }) => {
      const bound = await factsBackend.open(lease);
      const exported = await bound.repository.exportFacts();
      const storageLocal = filterStorageForBackup(await storageGetAll());
      const result = await buildBackupZipV2({
        facts: exported.facts,
        storageLocal,
        warnings: exported.warnings,
      });
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      parseStreamDescriptor({ operation: 'zip-backup', declaredTotalBytes: bytes.byteLength }, ['zip-backup']);
      await send(bytes);
      try {
        await storageSet({ [LAST_BACKUP_EXPORT_AT_STORAGE_KEY]: Date.parse(result.exportedAt) || Date.now() });
      } catch {
        // Export bytes are already complete; timestamp metadata is best-effort only.
      }
    },
    upload: async ({ bytes, lease }) => {
      // Parse the complete ZIP/JSON and all nested documents before selecting or mutating a facts backend.
      const parsed = await parseIncomingBackup(bytes);
      const bound = await factsBackend.open(lease);
      const stats = await bound.repository.importFacts(parsed.facts);
      stats.messagesSkipped += parsed.preSkippedMessages;
      const settings = filterStorageForBackupImport(parsed.storageLocal);
      const settingsKeys = Object.keys(settings);
      if (settingsKeys.length) {
        await storageSet(settings);
        stats.settingsApplied = settingsKeys.length;
      }
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, { reason: 'backupImported' });
      return parseJsonValue(stats);
    },
  });
}

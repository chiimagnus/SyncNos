import runtimeContext from '../runtime-context.ts';
import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_SCHEMA_VERSION,
  STORAGE_ALLOWLIST,
  filterStorageForBackup,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
} from '../backup/backup-utils';

const backupUtilsApi = {
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_SCHEMA_VERSION,
  STORAGE_ALLOWLIST,
  uniqueConversationKey,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  filterStorageForBackup,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
};

runtimeContext.backupUtils = backupUtilsApi;

export {
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_SCHEMA_VERSION,
  STORAGE_ALLOWLIST,
  uniqueConversationKey,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  filterStorageForBackup,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
};

export default backupUtilsApi;

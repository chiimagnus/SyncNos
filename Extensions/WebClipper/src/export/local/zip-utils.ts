import runtimeContext from '../../runtime-context.ts';
import {
  createZipBlob,
  extractZipEntries,
  isUnsafeZipEntryName,
} from '../../domains/backup/zip-utils';

const api = { createZipBlob, extractZipEntries, isUnsafeZipEntryName };
(runtimeContext as any).zipUtils = api;

export { createZipBlob, extractZipEntries, isUnsafeZipEntryName };
export default api;

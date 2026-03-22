import { createZipBlob, extractZipEntries, isUnsafeZipEntryName } from '@services/sync/backup/zip-utils';

const api = { createZipBlob, extractZipEntries, isUnsafeZipEntryName };

export { createZipBlob, extractZipEntries, isUnsafeZipEntryName };
export default api;

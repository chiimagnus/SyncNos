import {
  storageGet as platformStorageGet,
  storageGetAll as platformStorageGetAll,
  storageOnChanged as platformStorageOnChanged,
  storageRemove as platformStorageRemove,
  storageSet as platformStorageSet,
} from '@platform/storage/local';

export const storageLocal = {
  get: platformStorageGet,
  getAll: platformStorageGetAll,
  set: platformStorageSet,
  remove: platformStorageRemove,
  onChanged: platformStorageOnChanged,
};

export {
  platformStorageGet as storageGet,
  platformStorageGetAll as storageGetAll,
  platformStorageSet as storageSet,
  platformStorageRemove as storageRemove,
  platformStorageOnChanged as storageOnChanged,
};

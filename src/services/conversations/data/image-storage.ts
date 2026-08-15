import { createIdbImageStorage } from './image-storage-idb';
import { createNativeImageStorage } from './image-storage-native';

import type { FactsBackendMode } from '@services/local-data/facts-backend';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';

export type ImageAssetOwner = ResolvedConversationReference;

export type ImageAssetReference = Readonly<{
  byteSize: number;
  contentType: string;
  id: number;
}>;

export type ImageAsset = ImageAssetReference &
  Readonly<{
    blob: Blob;
    conversationId: number;
    url: string;
  }>;

export type ImageAssetWriteInput = Readonly<{
  blob: Blob;
  byteSize: number;
  contentType: string;
  dataUrl?: string;
  owner: ImageAssetOwner;
  url: string;
}>;

/** One facts-lease-bound image capability; callers never select an IDB or Host backend themselves. */
export type ImageStorage = Readonly<{
  findAssetByUrl: (owner: ImageAssetOwner, url: string) => Promise<ImageAssetReference | null>;
  getAsset: (owner: ImageAssetOwner, id: number) => Promise<ImageAsset | null>;
  putAsset: (input: ImageAssetWriteInput) => Promise<ImageAssetReference>;
}>;

export function createImageStorage(
  input: Readonly<{ lease: FactsOperationLease; mode: FactsBackendMode }>,
): ImageStorage {
  assertFactsOperationLease(input.lease);
  return input.mode === 'idb' ? createIdbImageStorage(input.lease) : createNativeImageStorage(input.lease);
}

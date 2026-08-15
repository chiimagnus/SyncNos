import { connectNative, type NativeHostRequest } from '@platform/local-data/native-client';
import {
  LocalDataContractError,
  type HostConversationReference,
  type HostFactsCommand,
} from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';

import type { ImageAsset, ImageAssetOwner, ImageAssetReference, ImageStorage } from './image-storage';

type NativeImageCommand = Extract<HostFactsCommand, 'FIND_IMAGE_ASSET_BY_URL' | 'GET_IMAGE_ASSET' | 'PUT_IMAGE_ASSET'>;
type NativeConnect = <TData>(input: NativeHostRequest<NativeImageCommand>) => Promise<TData>;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function ownerReference(owner: ImageAssetOwner): HostConversationReference {
  const source = String(owner?.source || '').trim();
  const conversationKey = String(owner?.conversationKey || '').trim();
  const backendConversationId = Number(owner?.conversationId);
  if (!source || !conversationKey || !Number.isSafeInteger(backendConversationId) || backendConversationId <= 0) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return { source, conversationKey, backendConversationId };
}

function metadata(value: unknown): ImageAssetReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const input = value as Record<string, unknown>;
  const id = Number(input.backendAssetId);
  const byteSize = Number(input.byteSize);
  const contentType = String(input.contentType || '')
    .trim()
    .toLowerCase();
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(byteSize) || byteSize <= 0 || !contentType) {
    protocolFailure();
  }
  return Object.freeze({ id, byteSize, contentType });
}

function streamedAsset(value: unknown, owner: ImageAssetOwner): ImageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const input = value as Record<string, unknown>;
  const reference = metadata(input);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== reference.byteSize) protocolFailure();
  return Object.freeze({
    ...reference,
    blob: new Blob([Uint8Array.from(input.bytes)], { type: reference.contentType }),
    conversationId: owner.conversationId,
    url: '',
  });
}

/** Native image access is always an explicit typed Host command under the caller's lease. */
export function createNativeImageStorage(
  lease: FactsOperationLease,
  dependencies: Readonly<{ connectNative?: NativeConnect }> = {},
): ImageStorage {
  const nativeConnect = dependencies.connectNative ?? (connectNative as NativeConnect);
  const request = async <TData>(
    command: NativeImageCommand,
    payload: NativeHostRequest<NativeImageCommand>['payload'],
    uploadBytes?: Uint8Array,
  ): Promise<TData> => {
    assertFactsOperationLease(lease);
    const result = await nativeConnect<TData>({
      command,
      payload,
      ...(uploadBytes ? { uploadBytes } : {}),
    } as NativeHostRequest<NativeImageCommand>);
    assertFactsOperationLease(lease);
    return result;
  };

  return Object.freeze({
    async findAssetByUrl(owner, rawUrl) {
      const url = String(rawUrl || '').trim();
      if (!url) return null;
      const result = await request<unknown>('FIND_IMAGE_ASSET_BY_URL', { owner: ownerReference(owner), url });
      return result == null ? null : metadata(result);
    },
    async getAsset(owner, id) {
      const assetId = Number(id);
      if (!Number.isSafeInteger(assetId) || assetId <= 0) return null;
      const result = await request<unknown>('GET_IMAGE_ASSET', {
        owner: ownerReference(owner),
        backendAssetId: assetId,
        // The Host response header, not the request, declares the exact byte count.
        transfer: { operation: 'image-asset', declaredTotalBytes: 0 },
      });
      return streamedAsset(result, owner);
    },
    async putAsset(input) {
      const url = String(input.url || '').trim();
      if (!url || !(input.blob instanceof Blob)) throw new LocalDataContractError('INVALID_ARGUMENT');
      const bytes = new Uint8Array(await input.blob.arrayBuffer());
      const byteSize = Number(input.byteSize) || bytes.byteLength;
      const contentType = String(input.contentType || input.blob.type || '')
        .trim()
        .toLowerCase();
      if (bytes.byteLength !== byteSize || !contentType) throw new LocalDataContractError('INVALID_ARGUMENT');
      const result = await request<unknown>(
        'PUT_IMAGE_ASSET',
        {
          owner: ownerReference(input.owner),
          metadata: { url, contentType },
          transfer: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
        },
        bytes,
      );
      return metadata(result);
    },
  });
}

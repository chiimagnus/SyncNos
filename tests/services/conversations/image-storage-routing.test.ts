import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { createIdbImageStorage, __closeImageStorageDbForTests } from '@services/conversations/data/image-storage-idb';
import { createNativeImageStorage } from '@services/conversations/data/image-storage-native';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  parseHostFactsRequest,
  type HostFactsCommand,
} from '@services/local-data/contracts';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

import {
  readNativeHostConnectedCommand,
  readNativeHostImageAsset,
  writeNativeHostImageAsset,
} from '../../../packages/syncnoscli/src/native-host/dispatcher';
import { createSqliteTestFixture } from '../../syncnoscli/sqlite-test-fixture';

const owner = { source: 'chatgpt', conversationKey: 'image-owner', conversationId: 7 };
const sqliteFixture = createSqliteTestFixture('syncnoscli-image-storage-routing-');

function hostRequest(command: HostFactsCommand, payload: unknown) {
  return parseHostFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    command,
    payload,
  });
}

function createGate(mode: 'active' | 'not_started' = 'not_started') {
  return new FactsOperationGate({
    readJournal: async () =>
      mode === 'active'
        ? {
            mode: 'active',
            journal: { migrationId: '550e8400-e29b-41d4-a716-446655440000', stage: 'active' },
            factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440000',
            error: null,
          }
        : { mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null },
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb(name: string) {
  await requestToPromise(indexedDB.deleteDatabase(name) as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  await __closeImageStorageDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeImageStorageDbForTests();
  await sqliteFixture.cleanup();
  vi.restoreAllMocks();
});

describe('lease-bound image storage', () => {
  it('keeps IDB cache lookup and asset ownership inside the bound facade', async () => {
    const gate = createGate();
    await gate.initializeFromJournal();

    await gate.runFactsOperation('idb-image-storage', async (lease) => {
      const storage = createIdbImageStorage(lease);
      const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });
      const stored = await storage.putAsset({
        owner,
        url: 'https://example.com/image.png',
        blob,
        byteSize: blob.size,
        contentType: blob.type,
      });
      await expect(storage.findAssetByUrl(owner, 'https://example.com/image.png')).resolves.toEqual(stored);
      await expect(storage.getAsset(owner, stored.id)).resolves.toMatchObject({
        id: stored.id,
        conversationId: owner.conversationId,
        byteSize: blob.size,
      });
      await expect(storage.getAsset({ ...owner, conversationId: 8 }, stored.id)).resolves.toBeNull();
      await expect(
        storage.putAsset({
          owner,
          url: 'https://example.com/mismatched.png',
          blob,
          byteSize: blob.size + 1,
          contentType: blob.type,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });

  it('maps Native find/read/write to typed Host commands without opening IDB', async () => {
    const calls: Array<{ command: string; payload: unknown; uploadBytes?: Uint8Array }> = [];
    const connectNative = vi.fn(async (input: any) => {
      calls.push(input);
      switch (input.command) {
        case 'FIND_IMAGE_ASSET_BY_URL':
          return { backendAssetId: 21, byteSize: 3, contentType: 'image/png' };
        case 'PUT_IMAGE_ASSET':
          return { backendAssetId: 22, byteSize: 3, contentType: 'image/png' };
        case 'GET_IMAGE_ASSET':
          return { backendAssetId: 22, byteSize: 3, contentType: 'image/png', bytes: Uint8Array.from([4, 5, 6]) };
        default:
          throw new Error(`unexpected ${input.command}`);
      }
    });
    const gate = createGate('active');
    await gate.initializeFromJournal();

    await gate.runFactsOperation('native-image-storage', async (lease) => {
      const storage = createNativeImageStorage(lease, { connectNative });
      await expect(storage.findAssetByUrl(owner, 'https://example.com/image.png')).resolves.toEqual({
        id: 21,
        byteSize: 3,
        contentType: 'image/png',
      });
      const blob = new Blob([Uint8Array.from([4, 5, 6])], { type: 'image/png' });
      await expect(
        storage.putAsset({
          owner,
          url: 'https://example.com/image.png',
          blob,
          byteSize: blob.size,
          contentType: blob.type,
        }),
      ).resolves.toEqual({ id: 22, byteSize: 3, contentType: 'image/png' });
      await expect(storage.getAsset(owner, 22)).resolves.toMatchObject({
        id: 22,
        byteSize: 3,
        conversationId: owner.conversationId,
      });
    });

    expect(calls.map((call) => call.command)).toEqual([
      'FIND_IMAGE_ASSET_BY_URL',
      'PUT_IMAGE_ASSET',
      'GET_IMAGE_ASSET',
    ]);
    expect(calls[0]?.payload).toEqual({
      owner: {
        source: owner.source,
        conversationKey: owner.conversationKey,
        backendConversationId: owner.conversationId,
      },
      url: 'https://example.com/image.png',
    });
    expect(calls[1]?.payload).toMatchObject({
      owner: {
        source: owner.source,
        conversationKey: owner.conversationKey,
        backendConversationId: owner.conversationId,
      },
      metadata: { url: 'https://example.com/image.png', contentType: 'image/png' },
      transfer: { operation: 'image-asset', declaredTotalBytes: 3 },
    });
    expect(calls[1]?.uploadBytes).toEqual(Uint8Array.from([4, 5, 6]));
    expect(JSON.stringify(calls)).not.toContain('factsEpoch');
  });

  it('enforces the Host owner before finding, writing, or streaming image bytes', async () => {
    const { conversations, database } = await sqliteFixture.open();
    const conversation = conversations.upsertConversation({
      sourceType: 'chat',
      source: owner.source,
      conversationKey: owner.conversationKey,
      title: 'Image owner',
      lastCapturedAt: 1,
    });
    const hostOwner = {
      source: owner.source,
      conversationKey: owner.conversationKey,
      backendConversationId: conversation.id,
    };
    const bytes = Uint8Array.from([9, 8, 7]);
    const stored = await writeNativeHostImageAsset(
      database,
      hostRequest('PUT_IMAGE_ASSET', {
        owner: hostOwner,
        metadata: { url: 'https://example.com/image.png', contentType: 'image/png' },
        transfer: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      }),
      bytes,
    );
    expect(stored).toEqual({ backendAssetId: expect.any(Number), byteSize: 3, contentType: 'image/png' });

    expect(
      readNativeHostConnectedCommand(
        database,
        hostRequest('FIND_IMAGE_ASSET_BY_URL', { owner: hostOwner, url: 'https://example.com/image.png' }),
      ),
    ).toEqual(stored);
    expect(
      readNativeHostImageAsset(
        database,
        hostRequest('GET_IMAGE_ASSET', {
          owner: hostOwner,
          backendAssetId: stored.backendAssetId,
          transfer: { operation: 'image-asset', declaredTotalBytes: 0 },
        }),
      ),
    ).toEqual({ bytes, metadata: stored });
    await expect(
      writeNativeHostImageAsset(
        database,
        hostRequest('PUT_IMAGE_ASSET', {
          owner: { ...hostOwner, backendConversationId: conversation.id + 1 },
          metadata: { url: 'https://example.com/other.png', contentType: 'image/png' },
          transfer: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
        }),
        bytes,
      ),
    ).rejects.toMatchObject({ code: 'STALE_REFERENCE' });
  });
});

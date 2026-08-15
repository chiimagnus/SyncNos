import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import type { ConversationFactsReference } from '@services/conversations/domain/models';
import {
  LOCAL_DATA_ERROR_CODES,
  LocalDataContractError,
  parseFactsEpoch,
  parseStreamDescriptor,
  type FactsEpoch,
  type LocalDataErrorCode,
  type StreamDescriptor,
} from '@services/local-data/contracts';

import { receiveLocalDataDownloadStream } from './repo';

type ApiResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message: string; extra: unknown }> | null;
  ok: boolean;
}>;

export type ConversationImageAsset = Readonly<{
  blob: Blob;
  byteSize: number;
  contentType: string;
  id: number;
}>;

export type ConversationImageAssetResolver = (assetId: number) => Promise<ConversationImageAsset | null>;

type ImageAssetStreamPreflight = Readonly<{
  contentType: string;
  kind: 'stream';
  requestId: string;
  stream: StreamDescriptor;
}>;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) protocolFailure();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) protocolFailure();
}

function text(value: unknown): string {
  if (typeof value !== 'string') protocolFailure();
  const normalized = value.trim();
  if (!normalized) protocolFailure();
  return normalized;
}

function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) protocolFailure();
  return Number(value);
}

function imageContentType(value: unknown): string {
  const contentType = text(value).toLowerCase();
  if (!/^image\/[a-z0-9.+-]+$/.test(contentType)) protocolFailure();
  return contentType;
}

function reference(input: ConversationFactsReference): Readonly<{
  conversationKey: string;
  factsEpoch: FactsEpoch;
  source: string;
}> {
  return Object.freeze({
    source: text(input?.source),
    conversationKey: text(input?.conversationKey),
    factsEpoch: parseFactsEpoch(input?.factsEpoch),
  });
}

function unwrap<T>(response: ApiResponse<T>): T | null {
  if (!response || typeof response.ok !== 'boolean') throw new LocalDataContractError('HOST_UNAVAILABLE');
  if (response.ok) {
    if (!Object.prototype.hasOwnProperty.call(response, 'data') || response.data === undefined) protocolFailure();
    return response.data;
  }
  const code = (response.error?.extra as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && LOCAL_DATA_ERROR_CODES.includes(code as LocalDataErrorCode)) {
    throw new LocalDataContractError(code as LocalDataErrorCode);
  }
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function parseImageAssetPreflight(value: unknown): ImageAssetStreamPreflight {
  const input = record(value);
  exactKeys(input, ['contentType', 'kind', 'requestId', 'stream']);
  if (input.kind !== 'stream') protocolFailure();
  const stream = parseStreamDescriptor(input.stream, ['image-asset']);
  if (stream.declaredTotalBytes <= 0) protocolFailure();
  return Object.freeze({
    kind: 'stream',
    requestId: text(input.requestId),
    stream,
    contentType: imageContentType(input.contentType),
  });
}

/** Reads one owner-bound image only through the authenticated facts stream. */
export async function getConversationImageAsset(
  input: Readonly<{
    assetId: number;
    reference: ConversationFactsReference;
  }>,
): Promise<ConversationImageAsset | null> {
  const owner = reference(input.reference);
  const id = positiveId(input.assetId);
  const response = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_IMAGE_ASSET, {
    source: owner.source,
    conversationKey: owner.conversationKey,
    factsEpoch: owner.factsEpoch,
    assetId: id,
  });
  const rawPreflight = unwrap(response);
  if (rawPreflight == null) return null;
  const preflight = parseImageAssetPreflight(rawPreflight);
  const bytes = await receiveLocalDataDownloadStream(preflight);
  if (bytes.byteLength !== preflight.stream.declaredTotalBytes) protocolFailure();
  return Object.freeze({
    id,
    byteSize: bytes.byteLength,
    contentType: preflight.contentType,
    blob: new Blob([Uint8Array.from(bytes)], { type: preflight.contentType }),
  });
}

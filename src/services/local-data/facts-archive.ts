import { parseArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import {
  MAX_MIGRATION_FACT_RECORD_BYTES,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  LocalDataContractError,
  parseOrderedFrameDigest,
  type JsonObject,
  type JsonValue,
} from './contracts';
import { sha256Hex, type DigestProvider } from './digest';
import { FACT_STREAM_KINDS, type FactStreamKind } from './facts-manifest';

export const MIGRATION_FACT_ARCHIVE_VERSION = 1 as const;
export const MIGRATION_COMMENT_IDENTITY_VERSION = 1 as const;
export const MAX_CANONICAL_RECORD_JSON_CHUNK_BYTES = 128 * 1024;

const MAX_CANONICAL_JSON_DEPTH = 128;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DATA_IMAGE_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+)(?:;charset=[a-z0-9._-]+)?(;base64)?,/i;
const BASE64_DECODE_INPUT_BYTES = 64 * 1024;
const SOURCE_LOCAL_ID_PATTERN = /^[1-9][0-9]{0,15}$/;
const textEncoder = new TextEncoder();
const strictTextDecoder = new TextDecoder('utf-8', { fatal: true });

type UnknownRecord = Record<string, any>;
type MutableJsonObject = Record<string, JsonValue>;

export type MigrationSourceLocalId = string;

export type MigrationConversationIdentity = Readonly<{
  conversationKey: string;
  source: string;
}>;

export type CanonicalJson = Readonly<{
  bytes: Uint8Array;
  text: string;
}>;

type MigrationFactBase<TKind extends FactStreamKind> = Readonly<{
  archiveVersion: typeof MIGRATION_FACT_ARCHIVE_VERSION;
  kind: TKind;
  payload: JsonObject;
  sourceLocalId: MigrationSourceLocalId;
}>;

export type MigrationConversationFact = MigrationFactBase<'conversations'>;

export type MigrationSyncMappingFact = MigrationFactBase<'sync_mappings'>;

export type MigrationMessageFact = MigrationFactBase<'messages'> &
  Readonly<{
    conversationSourceLocalId: MigrationSourceLocalId;
  }>;

export type MigrationImageFact = MigrationFactBase<'image_cache'> &
  Readonly<{
    byteLength: number;
    contentType: string;
    conversationSourceLocalId: MigrationSourceLocalId;
  }>;

export type MigrationCommentArchiveIdentity = Readonly<{
  context: Readonly<{
    canonicalUrl: string;
    conversation?: MigrationConversationIdentity;
  }>;
  occurrence: number;
  role: 'reply' | 'root';
  rootStructuralDigest: string;
  structuralDigest: string;
  version: typeof MIGRATION_COMMENT_IDENTITY_VERSION;
}>;

export type MigrationCommentFact = MigrationFactBase<'article_comments'> &
  Readonly<{
    archiveIdentity: MigrationCommentArchiveIdentity;
    conversationSourceLocalId: MigrationSourceLocalId | null;
    parentSourceLocalId: MigrationSourceLocalId | null;
  }>;

export type MigrationFactRecord =
  | MigrationConversationFact
  | MigrationSyncMappingFact
  | MigrationMessageFact
  | MigrationImageFact
  | MigrationCommentFact;

export type MigrationImageByteSource =
  | Readonly<{
      byteLength: number;
      contentType: string;
      kind: 'blob';
      blob: Blob;
    }>
  | Readonly<{
      byteLength: number;
      contentType: string;
      kind: 'view';
      view: Uint8Array;
    }>
  | Readonly<{
      byteLength: number;
      contentType: string;
      encoding: 'base64' | 'percent-utf8';
      kind: 'data-url';
      payload: string;
    }>;

export type PreparedMigrationImageFact = Readonly<{
  bytes: MigrationImageByteSource;
  record: MigrationImageFact;
}>;

export type MigrationCommentOccurrenceTracker = Readonly<{
  allocate: (input: { sourceLocalId: MigrationSourceLocalId; structuralDigest: string }) => number;
}>;

export type MigrationCommentTopologyNode = Readonly<{
  context: string;
  createdAt: number;
  id: number;
  parentId: number | null;
  rootStructuralDigest: string;
}>;

export type MigrationCommentTopologyEntry = Readonly<{
  parentId: number | null;
  rootStructuralDigest: string;
}>;

export type MigrationCommentMergeDecision =
  | Readonly<{ action: 'merge'; diagnostic: null }>
  | Readonly<{
      action: 'insert';
      diagnostic: Readonly<{
        code: 'ambiguous_comment_signature';
        incomingGroupCount: number;
        targetGroupCount: number;
      }> | null;
    }>;

export type MigrationCommentGraphValidator = Readonly<{
  add: (record: MigrationCommentFact) => void;
  finalize: () => void;
}>;

export type MigrationFactReferenceValidator = Readonly<{
  add: (record: MigrationFactRecord) => void;
  finalize: () => void;
}>;

function fail(
  code: 'INVALID_ARGUMENT' | 'MIGRATION_VALIDATION_FAILED' | 'PAYLOAD_TOO_LARGE' = 'MIGRATION_VALIDATION_FAILED',
): never {
  throw new LocalDataContractError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail();
  return value;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function parseNonNegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail();
  return Number(value);
}

function parsePositiveSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail();
  return Number(value);
}

function parseOptionalSourceLocalId(value: unknown): MigrationSourceLocalId | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !SOURCE_LOCAL_ID_PATTERN.test(value)) fail();
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || String(numeric) !== value) fail();
  return value;
}

function parseSourceLocalId(value: unknown): MigrationSourceLocalId {
  const parsed = parseOptionalSourceLocalId(value);
  if (!parsed) fail();
  return parsed;
}

function sourceLocalIdFromNumeric(value: unknown): MigrationSourceLocalId {
  return String(parsePositiveSafeInteger(value));
}

function sourceLocalIdToNumeric(value: MigrationSourceLocalId): number {
  return parsePositiveSafeInteger(Number(parseSourceLocalId(value)));
}

function parseRequiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || hasUnpairedSurrogate(value)) fail();
  return value;
}

function parseImageContentType(value: unknown): string {
  const contentType = normalizeImageContentType(value);
  if (!/^image\/[a-z0-9.+-]+$/.test(contentType)) fail();
  return contentType;
}

function parseStableConversationIdentity(value: unknown): MigrationConversationIdentity {
  const input = record(value);
  exactKeys(input, ['source', 'conversationKey']);
  return Object.freeze({
    source: parseRequiredText(input.source),
    conversationKey: parseRequiredText(input.conversationKey),
  });
}

function assertRawIdMatches(raw: Record<string, unknown>, sourceLocalId: MigrationSourceLocalId): void {
  if (!hasOwn(raw, 'id')) return;
  if (sourceLocalIdFromNumeric(raw.id) !== sourceLocalId) fail();
}

function omitKnownFields(raw: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const omitted = new Set(fields);
  const next: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(raw)) {
    if (!omitted.has(key)) next[key] = raw[key];
  }
  return next;
}

function canonicalJsonValue(value: unknown, depth = 0, ancestors = new Set<object>()): JsonValue {
  if (depth > MAX_CANONICAL_JSON_DEPTH) fail();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) fail();
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail();
    if (
      Object.getOwnPropertySymbols(value).length ||
      Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key))
    ) {
      fail();
    }
    ancestors.add(value);
    try {
      const next: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) fail();
        next.push(canonicalJsonValue(value[index], depth + 1, ancestors));
      }
      return Object.freeze(next);
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isRecord(value)) fail();
  if (ancestors.has(value)) fail();
  const names = Object.getOwnPropertyNames(value);
  const keys = Object.keys(value);
  if (Object.getOwnPropertySymbols(value).length || names.length !== keys.length) fail();
  ancestors.add(value);
  try {
    const next: MutableJsonObject = Object.create(null);
    for (const key of keys.sort()) {
      if (hasUnpairedSurrogate(key)) fail();
      Object.defineProperty(next, key, {
        configurable: true,
        enumerable: true,
        value: canonicalJsonValue(value[key], depth + 1, ancestors),
        writable: true,
      });
    }
    return Object.freeze(next);
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJsonObject(value: unknown): JsonObject {
  const parsed = canonicalJsonValue(value);
  if (!isRecord(parsed)) fail();
  return parsed as JsonObject;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertMigrationRecordByteLength(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
}

function parseFactKind(value: unknown): FactStreamKind {
  if (typeof value !== 'string' || !FACT_STREAM_KINDS.includes(value as FactStreamKind)) fail();
  return value as FactStreamKind;
}

function parseArchiveVersion(value: unknown): typeof MIGRATION_FACT_ARCHIVE_VERSION {
  if (value !== MIGRATION_FACT_ARCHIVE_VERSION) fail();
  return MIGRATION_FACT_ARCHIVE_VERSION;
}

function parseCommonFact(
  value: unknown,
  kind: FactStreamKind,
  extraKeys: readonly string[],
): MigrationFactBase<FactStreamKind> {
  const input = record(value);
  exactKeys(input, ['archiveVersion', 'kind', 'sourceLocalId', 'payload', ...extraKeys]);
  if (input.kind !== kind) fail();
  return Object.freeze({
    archiveVersion: parseArchiveVersion(input.archiveVersion),
    kind,
    sourceLocalId: parseSourceLocalId(input.sourceLocalId),
    payload: canonicalJsonObject(input.payload),
  });
}

function parseConversationPayload(payload: JsonObject): void {
  parseStableConversationIdentity({ source: payload.source, conversationKey: payload.conversationKey });
}

function parseMessagePayload(payload: JsonObject): void {
  parseRequiredText(payload.messageKey);
}

function parseImagePayload(payload: JsonObject, contentType: string, byteLength: number): void {
  if (hasOwn(payload as Record<string, unknown>, 'id')) fail();
  if (hasOwn(payload as Record<string, unknown>, 'conversationId')) fail();
  if (hasOwn(payload as Record<string, unknown>, 'blob')) fail();
  if (hasOwn(payload as Record<string, unknown>, 'dataUrl')) fail();
  if (payload.contentType !== contentType || payload.byteSize !== byteLength) fail();
}

function parseCommentPayload(payload: JsonObject): {
  canonicalUrl: string;
  locator: JsonValue | null;
} {
  const input = payload as Record<string, unknown>;
  for (const key of ['id', 'parentId', 'conversationId']) {
    if (hasOwn(input, key)) fail();
  }
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  if (!canonicalUrl || input.canonicalUrl !== canonicalUrl) fail();
  if (input.authorName !== null && typeof input.authorName !== 'string') fail();
  if (typeof input.quoteText !== 'string') fail();
  if (typeof input.commentText !== 'string' || !input.commentText.trim()) fail();
  if (!Number.isFinite(input.createdAt) || Number(input.createdAt) < 0) fail();
  if (!Number.isFinite(input.updatedAt) || Number(input.updatedAt) < 0) fail();
  if (input.locator !== null) {
    const parsedLocator = parseArticleCommentLocator(input.locator);
    if (!parsedLocator.ok) fail();
  }
  return { canonicalUrl, locator: (input.locator as JsonValue | undefined) ?? null };
}

function parseCommentContext(value: unknown): MigrationCommentArchiveIdentity['context'] {
  const input = record(value);
  const hasConversation = hasOwn(input, 'conversation');
  exactKeys(input, hasConversation ? ['canonicalUrl', 'conversation'] : ['canonicalUrl']);
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  if (!canonicalUrl || input.canonicalUrl !== canonicalUrl) fail();
  return Object.freeze({
    canonicalUrl,
    ...(hasConversation ? { conversation: parseStableConversationIdentity(input.conversation) } : {}),
  });
}

function parseCommentArchiveIdentity(value: unknown): MigrationCommentArchiveIdentity {
  const input = record(value);
  exactKeys(input, ['version', 'context', 'role', 'rootStructuralDigest', 'structuralDigest', 'occurrence']);
  if (input.version !== MIGRATION_COMMENT_IDENTITY_VERSION) fail();
  if (input.role !== 'root' && input.role !== 'reply') fail();
  return Object.freeze({
    version: MIGRATION_COMMENT_IDENTITY_VERSION,
    context: parseCommentContext(input.context),
    role: input.role,
    rootStructuralDigest: parseOrderedFrameDigest(input.rootStructuralDigest),
    structuralDigest: parseOrderedFrameDigest(input.structuralDigest),
    occurrence: parseNonNegativeSafeInteger(input.occurrence),
  });
}

function commentStructuralInput(input: {
  context: MigrationCommentArchiveIdentity['context'];
  payload: JsonObject;
  role: MigrationCommentArchiveIdentity['role'];
  rootStructuralDigest?: string;
}): JsonObject {
  if (input.role === 'reply' && !input.rootStructuralDigest) fail();
  if (input.role === 'root' && input.rootStructuralDigest) fail();
  return canonicalJsonObject({
    version: MIGRATION_COMMENT_IDENTITY_VERSION,
    context: input.context,
    role: input.role,
    payload: input.payload,
    ...(input.role === 'reply' ? { rootStructuralDigest: input.rootStructuralDigest! } : {}),
  });
}

function migrationCommentContext(input: {
  canonicalUrl: string;
  conversationSourceLocalId: MigrationSourceLocalId | null;
  conversations: ReadonlyMap<number, MigrationConversationIdentity>;
}): MigrationCommentArchiveIdentity['context'] {
  if (!input.conversationSourceLocalId) return Object.freeze({ canonicalUrl: input.canonicalUrl });
  const identity = input.conversations.get(sourceLocalIdToNumeric(input.conversationSourceLocalId));
  if (!identity) fail();
  return Object.freeze({
    canonicalUrl: input.canonicalUrl,
    conversation: parseStableConversationIdentity(identity),
  });
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

type Base64PayloadInfo = Readonly<{
  byteLength: number;
  normalizedPadding: number;
}>;

function isBase64Whitespace(value: string): boolean {
  return /\s/u.test(value);
}

function isBase64Character(value: string): boolean {
  return BASE64_ALPHABET.includes(value);
}

function analyzeBase64Payload(value: string): Base64PayloadInfo {
  let bodyLength = 0;
  let compactLength = 0;
  let paddingLength = 0;
  let sawPadding = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (isBase64Whitespace(character)) continue;
    compactLength += 1;
    if (character === '=') {
      sawPadding = true;
      paddingLength += 1;
      if (paddingLength > 2) fail();
      continue;
    }
    if (sawPadding || !isBase64Character(character)) fail();
    bodyLength += 1;
  }

  if (!compactLength || !bodyLength) fail();

  let normalizedPadding = paddingLength;
  let normalizedLength = compactLength;
  if (paddingLength) {
    if (compactLength % 4 !== 0) fail();
    if ((paddingLength === 1 && bodyLength % 4 !== 3) || (paddingLength === 2 && bodyLength % 4 !== 2)) fail();
  } else {
    if (bodyLength % 4 === 1) fail();
    normalizedPadding = (4 - (bodyLength % 4)) % 4;
    normalizedLength = bodyLength + normalizedPadding;
  }

  const byteLength = (normalizedLength / 4) * 3 - normalizedPadding;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) fail();
  if (byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
  return Object.freeze({ byteLength, normalizedPadding });
}

function hexByte(value: string, index: number): number {
  if (index + 2 >= value.length) fail();
  const parsed = Number.parseInt(value.slice(index + 1, index + 3), 16);
  if (!Number.isSafeInteger(parsed) || !/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) fail();
  return parsed;
}

function* decodedPercentUtf8Text(value: string): Generator<string> {
  if (hasUnpairedSurrogate(value)) fail();

  let index = 0;
  let literalStart = 0;
  while (index < value.length) {
    if (value[index] !== '%') {
      const codeUnit = value.charCodeAt(index);
      index += codeUnit >= 0xd800 && codeUnit <= 0xdbff ? 2 : 1;
      continue;
    }

    if (literalStart < index) yield value.slice(literalStart, index);

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const input = new Uint8Array(BASE64_DECODE_INPUT_BYTES);
    let inputLength = 0;
    const flush = (stream: boolean): string => {
      try {
        const decoded = inputLength ? decoder.decode(input.subarray(0, inputLength), { stream }) : '';
        inputLength = 0;
        return decoded;
      } catch (_error) {
        fail();
      }
    };

    while (index < value.length && value[index] === '%') {
      input[inputLength++] = hexByte(value, index);
      index += 3;
      if (inputLength === input.byteLength) {
        const decoded = flush(true);
        if (decoded) yield decoded;
      }
    }

    const decoded = flush(true);
    if (decoded) yield decoded;
    try {
      const trailing = decoder.decode();
      if (trailing) yield trailing;
    } catch (_error) {
      fail();
    }
    literalStart = index;
  }

  if (literalStart < value.length) yield value.slice(literalStart);
}

function utf8TextByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; ) {
    const part = utf8CodePointByteLength(value, index);
    byteLength += part.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
    index = part.nextIndex;
  }
  return byteLength;
}

function percentUtf8PayloadByteLength(value: string): number {
  let byteLength = 0;
  for (const text of decodedPercentUtf8Text(value)) {
    const nextLength = utf8TextByteLength(text);
    if (byteLength > MAX_MIGRATION_FACT_RECORD_BYTES - nextLength) fail('PAYLOAD_TOO_LARGE');
    byteLength += nextLength;
  }
  if (!byteLength) fail();
  return byteLength;
}

function parseDataImageUrl(value: unknown): Extract<MigrationImageByteSource, { kind: 'data-url' }> {
  if (typeof value !== 'string') fail();
  const dataUrl = value.trim();
  const matched = DATA_IMAGE_URL_PATTERN.exec(dataUrl);
  if (!matched) fail();
  const commaAt = matched[0].length - 1;
  const contentType = parseImageContentType(matched[1]);
  const payload = dataUrl.slice(commaAt + 1);
  if (matched[2]) {
    const base64 = analyzeBase64Payload(payload);
    return Object.freeze({ kind: 'data-url', contentType, byteLength: base64.byteLength, encoding: 'base64', payload });
  }
  const byteLength = percentUtf8PayloadByteLength(payload);
  return Object.freeze({ kind: 'data-url', contentType, byteLength, encoding: 'percent-utf8', payload });
}

function prepareImageByteSource(raw: Record<string, unknown>): MigrationImageByteSource {
  const declaredContentType = raw.contentType == null ? '' : parseImageContentType(raw.contentType);
  const blobValue = raw.blob;
  if (isBlob(blobValue)) {
    const blobContentType = blobValue.type ? parseImageContentType(blobValue.type) : '';
    if (declaredContentType && blobContentType && declaredContentType !== blobContentType) fail();
    const contentType = declaredContentType || blobContentType;
    const byteLength = blobValue.size;
    if (!contentType || !Number.isSafeInteger(byteLength) || byteLength <= 0) fail();
    if (byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
    return Object.freeze({ kind: 'blob', blob: blobValue, contentType, byteLength });
  }
  if (typeof ArrayBuffer !== 'undefined' && blobValue instanceof ArrayBuffer) {
    if (!declaredContentType || !blobValue.byteLength) fail();
    if (blobValue.byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
    return Object.freeze({
      kind: 'view',
      view: new Uint8Array(blobValue),
      contentType: declaredContentType,
      byteLength: blobValue.byteLength,
    });
  }
  if (blobValue && typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(blobValue)) {
    if (!declaredContentType || !blobValue.byteLength) fail();
    if (blobValue.byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
    return Object.freeze({
      kind: 'view',
      view: new Uint8Array(blobValue.buffer, blobValue.byteOffset, blobValue.byteLength),
      contentType: declaredContentType,
      byteLength: blobValue.byteLength,
    });
  }
  if (blobValue != null) fail();
  const dataUrl = parseDataImageUrl(raw.dataUrl);
  if (declaredContentType && declaredContentType !== dataUrl.contentType) fail();
  return Object.freeze({ ...dataUrl, contentType: declaredContentType || dataUrl.contentType });
}

function imageMetadataPayload(raw: Record<string, unknown>, source: MigrationImageByteSource): JsonObject {
  const payload = omitKnownFields(raw, ['id', 'conversationId', 'blob', 'dataUrl']);
  payload.contentType = source.contentType;
  payload.byteSize = source.byteLength;
  return canonicalJsonObject(payload);
}

function normaliseCommentPayload(raw: Record<string, unknown>): {
  canonicalUrl: string;
  payload: JsonObject;
} {
  const canonicalUrl = canonicalizeArticleUrl(raw.canonicalUrl);
  if (!canonicalUrl) fail();
  const authorName = raw.authorName == null ? null : typeof raw.authorName === 'string' ? raw.authorName : fail();
  const quoteText = raw.quoteText == null ? '' : typeof raw.quoteText === 'string' ? raw.quoteText : fail();
  const commentText = typeof raw.commentText === 'string' ? raw.commentText : '';
  if (!commentText.trim()) fail();
  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(createdAt) || createdAt < 0 || !Number.isFinite(updatedAt) || updatedAt < 0) fail();
  let locator: JsonValue | null = null;
  if (raw.locator != null) {
    const parsedLocator = parseArticleCommentLocator(raw.locator);
    if (!parsedLocator.ok) fail();
    locator = canonicalJsonValue(parsedLocator.value);
  }
  const payload = omitKnownFields(raw, ['id', 'parentId', 'conversationId']);
  payload.canonicalUrl = canonicalUrl;
  payload.authorName = authorName;
  payload.quoteText = quoteText;
  payload.commentText = commentText;
  payload.locator = locator;
  payload.createdAt = createdAt;
  payload.updatedAt = updatedAt;
  return { canonicalUrl, payload: canonicalJsonObject(payload) };
}

export async function createMigrationCommentTopologyNode(input: {
  conversations: ReadonlyMap<number, MigrationConversationIdentity>;
  digestProvider: DigestProvider;
  row: unknown;
  sourceLocalId: unknown;
}): Promise<MigrationCommentTopologyNode> {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const parentSourceLocalId = parseOptionalRawId(raw.parentId);
  const conversationSourceLocalId = parseOptionalRawId(raw.conversationId);
  const normalised = normaliseCommentPayload(raw);
  const context = migrationCommentContext({
    canonicalUrl: normalised.canonicalUrl,
    conversationSourceLocalId,
    conversations: input.conversations,
  });
  const rootStructuralDigest = await sha256Hex(
    input.digestProvider,
    encodeCanonicalJson(commentStructuralInput({ context, payload: normalised.payload, role: 'root' })).bytes,
  );
  return Object.freeze({
    context: encodeCanonicalJson(context).text,
    createdAt: Number(normalised.payload.createdAt),
    id: sourceLocalIdToNumeric(sourceLocalId),
    parentId: parentSourceLocalId ? sourceLocalIdToNumeric(parentSourceLocalId) : null,
    rootStructuralDigest,
  });
}

function parseOptionalRawId(value: unknown): MigrationSourceLocalId | null {
  if (value == null) return null;
  return sourceLocalIdFromNumeric(value);
}

function opaqueFieldUnion(
  existing: UnknownRecord,
  incoming: UnknownRecord,
  coreFields: readonly string[],
): UnknownRecord {
  const next: UnknownRecord = {};
  const core = new Set(coreFields);
  for (const input of [existing, incoming]) {
    const source = input && typeof input === 'object' ? input : {};
    for (const key of Object.keys(source)) {
      if (core.has(key) || Object.prototype.hasOwnProperty.call(next, key)) continue;
      next[key] = source[key];
    }
  }
  return next;
}

function migrationMerge(
  coreMerge: (existing: UnknownRecord, incoming: UnknownRecord) => UnknownRecord,
  coreFields: readonly string[],
  existing: UnknownRecord,
  incoming: UnknownRecord,
): UnknownRecord {
  const core = coreMerge(existing, incoming);
  const opaque = opaqueFieldUnion(existing, incoming, coreFields);
  return { ...opaque, ...core };
}

function pickStringPreferExisting(existing: unknown, incoming: unknown): string {
  const local = existing == null ? '' : String(existing);
  if (local.trim()) return local.trim();
  const remote = incoming == null ? '' : String(incoming);
  return remote.trim() ? remote.trim() : '';
}

function safeFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeWarningFlags(existing: unknown, incoming: unknown): string[] {
  const values = new Set<string>();
  for (const candidate of [existing, incoming]) {
    if (!Array.isArray(candidate)) continue;
    for (const value of candidate) {
      if (typeof value === 'string' && value.trim()) values.add(value.trim());
    }
  }
  return [...values];
}

function shouldPreferIncomingMessage(existing: UnknownRecord, incoming: UnknownRecord): boolean {
  const localUpdatedAt = Number(existing?.updatedAt) || 0;
  const incomingUpdatedAt = Number(incoming?.updatedAt) || 0;
  if (incomingUpdatedAt && incomingUpdatedAt > localUpdatedAt) return true;
  const localMarkdown = existing?.contentMarkdown && String(existing.contentMarkdown).trim();
  const incomingMarkdown = incoming?.contentMarkdown && String(incoming.contentMarkdown).trim();
  return !localMarkdown && Boolean(incomingMarkdown);
}

/** Existing ZIP merge semantics, kept here so native import uses the same conservative core. */
export function uniqueConversationKey(conversation: UnknownRecord): string {
  const source = conversation?.source ? String(conversation.source) : '';
  const conversationKey = conversation?.conversationKey ? String(conversation.conversationKey) : '';
  return source && conversationKey ? `${source}||${conversationKey}` : '';
}

export function mergeConversationRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const local = existing && typeof existing === 'object' ? existing : {};
  const remote = incoming && typeof incoming === 'object' ? incoming : {};
  const next: UnknownRecord = { ...local };
  next.sourceType = pickStringPreferExisting(local.sourceType, remote.sourceType) || 'chat';
  next.source = pickStringPreferExisting(local.source, remote.source);
  next.conversationKey = pickStringPreferExisting(local.conversationKey, remote.conversationKey);
  next.title = pickStringPreferExisting(local.title, remote.title);
  next.url = pickStringPreferExisting(local.url, remote.url);
  next.author = pickStringPreferExisting(local.author, remote.author);
  next.publishedAt = pickStringPreferExisting(local.publishedAt, remote.publishedAt);
  next.warningFlags = mergeWarningFlags(local.warningFlags, remote.warningFlags);
  next.notionPageId = pickStringPreferExisting(local.notionPageId, remote.notionPageId);
  next.lastCapturedAt = Math.max(Number(local.lastCapturedAt) || 0, Number(remote.lastCapturedAt) || 0, 0);
  return next;
}

export function mergeMessageRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const local = existing && typeof existing === 'object' ? existing : {};
  const remote = incoming && typeof incoming === 'object' ? incoming : {};
  const base = shouldPreferIncomingMessage(local, remote) ? { ...local, ...remote } : { ...remote, ...local };
  const next: UnknownRecord = { ...base };
  next.role = pickStringPreferExisting(base.role, 'assistant') || 'assistant';
  next.contentText = String(next.contentText || '');
  next.contentMarkdown = String(next.contentMarkdown || '');
  const updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0, 0);
  next.updatedAt = updatedAt || Date.now();
  const localSequence = Number(local.sequence);
  const remoteSequence = Number(remote.sequence);
  next.sequence = Number.isFinite(remoteSequence) ? remoteSequence : Number.isFinite(localSequence) ? localSequence : 0;
  return next;
}

export function mergeSyncMappingRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const local = existing && typeof existing === 'object' ? existing : {};
  const remote = incoming && typeof incoming === 'object' ? incoming : {};
  const next: UnknownRecord = { ...local };
  next.source = pickStringPreferExisting(local.source, remote.source);
  next.conversationKey = pickStringPreferExisting(local.conversationKey, remote.conversationKey);
  next.notionPageId = pickStringPreferExisting(local.notionPageId, remote.notionPageId);
  next.feishuDocId = pickStringPreferExisting(local.feishuDocId, remote.feishuDocId);
  next.lastSyncedMessageKey = pickStringPreferExisting(local.lastSyncedMessageKey, remote.lastSyncedMessageKey);
  const localSequence = safeFiniteNumber(local.lastSyncedSequence);
  const remoteSequence = safeFiniteNumber(remote.lastSyncedSequence);
  if (localSequence != null) next.lastSyncedSequence = localSequence;
  else if (remoteSequence != null) next.lastSyncedSequence = remoteSequence;

  const chosenKey = pickStringPreferExisting(next.lastSyncedMessageKey, '');
  const chosenSequence = safeFiniteNumber(next.lastSyncedSequence);
  const localKey = pickStringPreferExisting(local.lastSyncedMessageKey, '');
  const remoteKey = pickStringPreferExisting(remote.lastSyncedMessageKey, '');
  const localMatches = chosenKey
    ? localKey === chosenKey
    : chosenSequence != null && localSequence != null && localSequence === chosenSequence;
  const remoteMatches = chosenKey
    ? remoteKey === chosenKey
    : chosenSequence != null && remoteSequence != null && remoteSequence === chosenSequence;

  const localSyncedAt = safeFiniteNumber(local.lastSyncedAt);
  const remoteSyncedAt = safeFiniteNumber(remote.lastSyncedAt);
  if (localSyncedAt != null) next.lastSyncedAt = localSyncedAt;
  else if (remoteSyncedAt != null) next.lastSyncedAt = remoteSyncedAt;

  const localMessageUpdatedAt = safeFiniteNumber(local.lastSyncedMessageUpdatedAt);
  const remoteMessageUpdatedAt = safeFiniteNumber(remote.lastSyncedMessageUpdatedAt);
  if (localMatches && localMessageUpdatedAt != null) next.lastSyncedMessageUpdatedAt = localMessageUpdatedAt;
  else if (remoteMatches && remoteMessageUpdatedAt != null) next.lastSyncedMessageUpdatedAt = remoteMessageUpdatedAt;
  next.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);
  return next;
}

export function mergeMigrationConversationPayload(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  return migrationMerge(
    mergeConversationRecord,
    [
      'id',
      'sourceType',
      'source',
      'conversationKey',
      'title',
      'url',
      'author',
      'publishedAt',
      'warningFlags',
      'notionPageId',
      'lastCapturedAt',
    ],
    existing,
    incoming,
  );
}

export function mergeMigrationMessagePayload(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  return migrationMerge(
    mergeMessageRecord,
    ['id', 'conversationId', 'messageKey', 'role', 'contentText', 'contentMarkdown', 'updatedAt', 'sequence'],
    existing,
    incoming,
  );
}

export function mergeMigrationSyncMappingPayload(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  return migrationMerge(
    mergeSyncMappingRecord,
    [
      'id',
      'source',
      'conversationKey',
      'notionPageId',
      'feishuDocId',
      'lastSyncedMessageKey',
      'lastSyncedSequence',
      'lastSyncedAt',
      'lastSyncedMessageUpdatedAt',
      'updatedAt',
    ],
    existing,
    incoming,
  );
}

export const SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export function normalizeImageContentType(value: unknown): string {
  return String(value || '')
    .trim()
    .split(';')[0]!
    .trim()
    .toLowerCase();
}

export function isHttpUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

export function isDataImageUrl(value: unknown): boolean {
  return DATA_IMAGE_URL_PATTERN.test(String(value || '').trim());
}

export function normalizeFallbackImageUrl(value: unknown): string {
  const url = String(value || '').trim();
  return isHttpUrl(url) || isDataImageUrl(url) ? url : SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC;
}

export function rewriteSyncnosAssetUrlsInMarkdown(
  markdown: string,
  input: {
    defaultUrl?: string;
    fallbackUrlByOldId: ReadonlyMap<number, string>;
    remap: ReadonlyMap<number, number>;
  },
): string {
  const raw = String(markdown || '');
  if (!raw || !raw.includes('syncnos-asset://')) return raw;
  const defaultUrl = normalizeFallbackImageUrl(input.defaultUrl || SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC);
  return raw.replace(/syncnos-asset:\/\/(\d+)/gi, (full, idRaw) => {
    const oldId = Number(idRaw);
    if (!Number.isFinite(oldId) || oldId <= 0) return full;
    const nextId = input.remap.get(oldId);
    if (nextId) return `syncnos-asset://${nextId}`;
    return input.fallbackUrlByOldId.get(oldId) || defaultUrl;
  });
}

export function createMigrationConversationFact(input: {
  row: unknown;
  sourceLocalId: unknown;
}): MigrationConversationFact {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const result = parseMigrationFactRecord({
    archiveVersion: MIGRATION_FACT_ARCHIVE_VERSION,
    kind: 'conversations',
    sourceLocalId,
    payload: omitKnownFields(raw, ['id']),
  });
  if (result.kind !== 'conversations') fail();
  return result;
}

export function createMigrationSyncMappingFact(input: {
  row: unknown;
  sourceLocalId: unknown;
}): MigrationSyncMappingFact {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const result = parseMigrationFactRecord({
    archiveVersion: MIGRATION_FACT_ARCHIVE_VERSION,
    kind: 'sync_mappings',
    sourceLocalId,
    payload: omitKnownFields(raw, ['id']),
  });
  if (result.kind !== 'sync_mappings') fail();
  return result;
}

export function createMigrationMessageFact(input: { row: unknown; sourceLocalId: unknown }): MigrationMessageFact {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const result = parseMigrationFactRecord({
    archiveVersion: MIGRATION_FACT_ARCHIVE_VERSION,
    kind: 'messages',
    sourceLocalId,
    conversationSourceLocalId: sourceLocalIdFromNumeric(raw.conversationId),
    payload: omitKnownFields(raw, ['id', 'conversationId']),
  });
  if (result.kind !== 'messages') fail();
  return result;
}

export function prepareMigrationImageFact(input: { row: unknown; sourceLocalId: unknown }): PreparedMigrationImageFact {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const bytes = prepareImageByteSource(raw);
  const result = parseMigrationFactRecord({
    archiveVersion: MIGRATION_FACT_ARCHIVE_VERSION,
    kind: 'image_cache',
    sourceLocalId,
    conversationSourceLocalId: sourceLocalIdFromNumeric(raw.conversationId),
    contentType: bytes.contentType,
    byteLength: bytes.byteLength,
    payload: imageMetadataPayload(raw, bytes),
  });
  if (result.kind !== 'image_cache') fail();
  return Object.freeze({ bytes, record: result });
}

class BinarySliceWriter {
  private buffer: Uint8Array;
  private length = 0;

  constructor(private readonly maximumChunkBytes: number) {
    this.buffer = new Uint8Array(maximumChunkBytes);
  }

  writeByte(value: number): Uint8Array | null {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) fail();
    let completed: Uint8Array | null = null;
    if (this.length === this.buffer.byteLength) {
      completed = this.buffer;
      this.buffer = new Uint8Array(this.maximumChunkBytes);
      this.length = 0;
    }
    this.buffer[this.length++] = value;
    return completed;
  }

  finish(): Uint8Array | null {
    if (!this.length) return null;
    return this.buffer.slice(0, this.length);
  }
}

class Utf8SliceWriter {
  private buffer: Uint8Array;
  private length = 0;

  constructor(private readonly maximumChunkBytes: number) {
    this.buffer = new Uint8Array(maximumChunkBytes);
  }

  private appendEncoded(value: string): void {
    if (!value) return;
    const encoded = textEncoder.encode(value);
    if (!encoded.byteLength || encoded.byteLength > this.buffer.byteLength - this.length) fail();
    this.buffer.set(encoded, this.length);
    this.length += encoded.byteLength;
  }

  private takeBuffer(): Uint8Array {
    if (!this.length) fail();
    const completed = this.buffer.slice(0, this.length);
    this.buffer = new Uint8Array(this.maximumChunkBytes);
    this.length = 0;
    return completed;
  }

  write(value: string): Uint8Array[] {
    const completed: Uint8Array[] = [];
    let start = 0;
    let index = 0;
    let pendingByteLength = 0;
    while (index < value.length) {
      const part = utf8CodePointByteLength(value, index);
      if (part.byteLength > this.maximumChunkBytes) fail();
      if (pendingByteLength + part.byteLength > this.buffer.byteLength - this.length) {
        this.appendEncoded(value.slice(start, index));
        if (this.length) completed.push(this.takeBuffer());
        start = index;
        pendingByteLength = 0;
        continue;
      }
      pendingByteLength += part.byteLength;
      index = part.nextIndex;
    }
    this.appendEncoded(value.slice(start, index));
    return completed;
  }

  finish(): Uint8Array | null {
    return this.length ? this.takeBuffer() : null;
  }
}

function assertMigrationImageByteSource(source: MigrationImageByteSource, maximumChunkBytes: number): number {
  if (
    !source ||
    typeof source !== 'object' ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength <= 0 ||
    source.byteLength > MAX_MIGRATION_FACT_RECORD_BYTES ||
    !Number.isSafeInteger(maximumChunkBytes) ||
    maximumChunkBytes <= 0 ||
    maximumChunkBytes > MAX_NATIVE_IMAGE_SLICE_BYTES ||
    parseImageContentType(source.contentType) !== source.contentType
  ) {
    fail(source?.byteLength && source.byteLength > MAX_MIGRATION_FACT_RECORD_BYTES ? 'PAYLOAD_TOO_LARGE' : undefined);
  }
  return source.byteLength;
}

function* streamBase64DataUrlBytes(value: string, maximumChunkBytes: number): Generator<Uint8Array> {
  const info = analyzeBase64Payload(value);
  const writer = new BinarySliceWriter(maximumChunkBytes);
  let group = '';
  let outputLength = 0;

  const emitByte = (byte: number): Uint8Array | null => {
    outputLength += 1;
    if (outputLength > info.byteLength) fail();
    return writer.writeByte(byte);
  };

  const emitGroup = function* (base64Group: string): Generator<Uint8Array> {
    if (base64Group.length !== 4) fail();
    const a = BASE64_ALPHABET.indexOf(base64Group[0]!);
    const b = BASE64_ALPHABET.indexOf(base64Group[1]!);
    const c = base64Group[2] === '=' ? 0 : BASE64_ALPHABET.indexOf(base64Group[2]!);
    const d = base64Group[3] === '=' ? 0 : BASE64_ALPHABET.indexOf(base64Group[3]!);
    if (a < 0 || b < 0 || c < 0 || d < 0) fail();
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    const first = emitByte((packed >>> 16) & 0xff);
    if (first) yield first;
    if (base64Group[2] !== '=') {
      const second = emitByte((packed >>> 8) & 0xff);
      if (second) yield second;
    }
    if (base64Group[3] !== '=') {
      const third = emitByte(packed & 0xff);
      if (third) yield third;
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (isBase64Whitespace(character)) continue;
    group += character;
    if (group.length === 4) {
      yield* emitGroup(group);
      group = '';
    }
  }
  if (group) {
    group += '='.repeat(info.normalizedPadding);
    yield* emitGroup(group);
  }
  if (outputLength !== info.byteLength) fail();
  const finalSlice = writer.finish();
  if (finalSlice) yield finalSlice;
}

function* streamPercentUtf8DataUrlBytes(value: string, maximumChunkBytes: number): Generator<Uint8Array> {
  const writer = new Utf8SliceWriter(maximumChunkBytes);
  let outputLength = 0;
  for (const text of decodedPercentUtf8Text(value)) {
    for (const completed of writer.write(text)) {
      outputLength += completed.byteLength;
      if (outputLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
      yield completed;
    }
  }
  const finalSlice = writer.finish();
  if (finalSlice) {
    outputLength += finalSlice.byteLength;
    if (outputLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
    yield finalSlice;
  }
  if (!outputLength) fail();
}

/**
 * Iterates one already validated image source without retaining the full raw asset.
 * Call only after the IndexedDB transaction that supplied the source has completed.
 */
export async function* streamMigrationImageBytes(
  source: MigrationImageByteSource,
  maximumChunkBytes = MAX_NATIVE_IMAGE_SLICE_BYTES,
): AsyncGenerator<Uint8Array> {
  const declaredByteLength = assertMigrationImageByteSource(source, maximumChunkBytes);
  let outputLength = 0;

  const checkedSlice = (slice: Uint8Array): Uint8Array => {
    if (!(slice instanceof Uint8Array) || !slice.byteLength) fail();
    if (slice.byteLength > maximumChunkBytes || outputLength > declaredByteLength - slice.byteLength) fail();
    outputLength += slice.byteLength;
    return slice;
  };

  if (source.kind === 'blob') {
    if (!isBlob(source.blob) || source.blob.size !== declaredByteLength) fail();
    for (let offset = 0; offset < declaredByteLength; offset += maximumChunkBytes) {
      const nextOffset = Math.min(declaredByteLength, offset + maximumChunkBytes);
      const slice = new Uint8Array(await source.blob.slice(offset, nextOffset).arrayBuffer());
      if (slice.byteLength !== nextOffset - offset) fail();
      yield checkedSlice(slice);
    }
  } else if (source.kind === 'view') {
    if (!(source.view instanceof Uint8Array) || source.view.byteLength !== declaredByteLength) fail();
    for (let offset = 0; offset < declaredByteLength; offset += maximumChunkBytes) {
      yield checkedSlice(source.view.subarray(offset, Math.min(declaredByteLength, offset + maximumChunkBytes)));
    }
  } else if (source.kind === 'data-url') {
    if (typeof source.payload !== 'string') fail();
    const iterator =
      source.encoding === 'base64'
        ? streamBase64DataUrlBytes(source.payload, maximumChunkBytes)
        : source.encoding === 'percent-utf8'
          ? streamPercentUtf8DataUrlBytes(source.payload, maximumChunkBytes)
          : fail();
    for (const slice of iterator) yield checkedSlice(slice);
  } else {
    fail();
  }

  if (outputLength !== declaredByteLength) fail();
}

export function createMigrationCommentOccurrenceTracker(): MigrationCommentOccurrenceTracker {
  // ponytail: retain only a fixed-size signature and source-local counter, never comment payloads; use SQLite staging only if this identity map itself becomes too large.
  const state = new Map<string, { lastSourceLocalId: number; nextOccurrence: number }>();
  return Object.freeze({
    allocate(input) {
      const structure = parseOrderedFrameDigest(input.structuralDigest);
      const sourceLocalId = sourceLocalIdToNumeric(input.sourceLocalId);
      const current = state.get(structure);
      if (!current) {
        state.set(structure, { lastSourceLocalId: sourceLocalId, nextOccurrence: 1 });
        return 0;
      }
      if (sourceLocalId <= current.lastSourceLocalId) fail();
      const occurrence = current.nextOccurrence;
      current.lastSourceLocalId = sourceLocalId;
      current.nextOccurrence += 1;
      return occurrence;
    },
  });
}

export async function createMigrationCommentFact(input: {
  conversations: ReadonlyMap<number, MigrationConversationIdentity>;
  digestProvider: DigestProvider;
  occurrence?: unknown;
  occurrenceTracker?: MigrationCommentOccurrenceTracker;
  parentRootStructuralDigest?: unknown;
  row: unknown;
  sourceLocalId: unknown;
}): Promise<MigrationCommentFact> {
  const raw = record(input.row);
  const sourceLocalId = sourceLocalIdFromNumeric(input.sourceLocalId);
  assertRawIdMatches(raw, sourceLocalId);
  const parentSourceLocalId = parseOptionalRawId(raw.parentId);
  const conversationSourceLocalId = parseOptionalRawId(raw.conversationId);
  const normalised = normaliseCommentPayload(raw);
  const role = parentSourceLocalId ? 'reply' : 'root';
  const context = migrationCommentContext({
    canonicalUrl: normalised.canonicalUrl,
    conversationSourceLocalId,
    conversations: input.conversations,
  });
  const rootStructuralDigest = parentSourceLocalId
    ? parseOrderedFrameDigest(input.parentRootStructuralDigest)
    : await sha256Hex(
        input.digestProvider,
        encodeCanonicalJson(commentStructuralInput({ context, payload: normalised.payload, role })).bytes,
      );
  const structuralDigest = parentSourceLocalId
    ? await sha256Hex(
        input.digestProvider,
        encodeCanonicalJson(
          commentStructuralInput({
            context,
            payload: normalised.payload,
            role,
            rootStructuralDigest,
          }),
        ).bytes,
      )
    : rootStructuralDigest;
  const occurrence = input.occurrenceTracker
    ? input.occurrenceTracker.allocate({ sourceLocalId, structuralDigest })
    : input.occurrence == null
      ? 0
      : parseNonNegativeSafeInteger(input.occurrence);
  const result = parseMigrationFactRecord({
    archiveVersion: MIGRATION_FACT_ARCHIVE_VERSION,
    kind: 'article_comments',
    sourceLocalId,
    parentSourceLocalId,
    conversationSourceLocalId,
    payload: normalised.payload,
    archiveIdentity: {
      version: MIGRATION_COMMENT_IDENTITY_VERSION,
      context,
      role,
      rootStructuralDigest,
      structuralDigest,
      occurrence,
    },
  });
  if (result.kind !== 'article_comments') fail();
  return result;
}

export function parseMigrationFactRecord(value: unknown): MigrationFactRecord {
  const input = record(value);
  const kind = parseFactKind(input.kind);
  switch (kind) {
    case 'conversations': {
      const common = parseCommonFact(value, kind, []);
      parseConversationPayload(common.payload);
      return common as MigrationConversationFact;
    }
    case 'sync_mappings': {
      const common = parseCommonFact(value, kind, []);
      parseConversationPayload(common.payload);
      return common as MigrationSyncMappingFact;
    }
    case 'messages': {
      const common = parseCommonFact(value, kind, ['conversationSourceLocalId']);
      parseMessagePayload(common.payload);
      return Object.freeze({
        ...common,
        kind,
        conversationSourceLocalId: parseSourceLocalId(input.conversationSourceLocalId),
      });
    }
    case 'image_cache': {
      const common = parseCommonFact(value, kind, ['conversationSourceLocalId', 'contentType', 'byteLength']);
      const contentType = parseImageContentType(input.contentType);
      const byteLength = parsePositiveSafeInteger(input.byteLength);
      if (byteLength > MAX_MIGRATION_FACT_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
      parseImagePayload(common.payload, contentType, byteLength);
      return Object.freeze({
        ...common,
        kind,
        conversationSourceLocalId: parseSourceLocalId(input.conversationSourceLocalId),
        contentType,
        byteLength,
      });
    }
    case 'article_comments': {
      const common = parseCommonFact(value, kind, [
        'parentSourceLocalId',
        'conversationSourceLocalId',
        'archiveIdentity',
      ]);
      const parentSourceLocalId = parseOptionalSourceLocalId(input.parentSourceLocalId);
      const conversationSourceLocalId = parseOptionalSourceLocalId(input.conversationSourceLocalId);
      const archiveIdentity = parseCommentArchiveIdentity(input.archiveIdentity);
      const comment = parseCommentPayload(common.payload);
      if (archiveIdentity.context.canonicalUrl !== comment.canonicalUrl) fail();
      if ((parentSourceLocalId ? 'reply' : 'root') !== archiveIdentity.role) fail();
      if (archiveIdentity.role === 'root' && archiveIdentity.rootStructuralDigest !== archiveIdentity.structuralDigest)
        fail();
      if (Boolean(conversationSourceLocalId) !== Boolean(archiveIdentity.context.conversation)) fail();
      return Object.freeze({
        ...common,
        kind,
        parentSourceLocalId,
        conversationSourceLocalId,
        archiveIdentity,
      });
    }
  }
}

export async function verifyMigrationCommentFact(
  recordValue: MigrationCommentFact,
  provider: DigestProvider,
): Promise<void> {
  const record = parseMigrationFactRecord(recordValue);
  if (record.kind !== 'article_comments') fail();
  const digest = await sha256Hex(
    provider,
    encodeCanonicalJson(
      commentStructuralInput({
        context: record.archiveIdentity.context,
        payload: record.payload,
        role: record.archiveIdentity.role,
        rootStructuralDigest:
          record.archiveIdentity.role === 'reply' ? record.archiveIdentity.rootStructuralDigest : undefined,
      }),
    ).bytes,
  );
  if (digest !== record.archiveIdentity.structuralDigest) fail();
}

export function createMigrationCommentGraphValidator(): MigrationCommentGraphValidator {
  const entries = new Map<
    MigrationSourceLocalId,
    Readonly<{
      context: string;
      parentSourceLocalId: MigrationSourceLocalId | null;
      rootStructuralDigest: string;
    }>
  >();
  let finalized = false;

  return Object.freeze({
    add(recordValue) {
      if (finalized) fail();
      const record = parseMigrationFactRecord(recordValue);
      if (record.kind !== 'article_comments' || entries.has(record.sourceLocalId)) fail();
      entries.set(
        record.sourceLocalId,
        Object.freeze({
          context: encodeCanonicalJson(record.archiveIdentity.context).text,
          parentSourceLocalId: record.parentSourceLocalId,
          rootStructuralDigest: record.archiveIdentity.rootStructuralDigest,
        }),
      );
    },
    finalize() {
      if (finalized) fail();
      finalized = true;
      for (const entry of entries.values()) {
        if (!entry.parentSourceLocalId) continue;
        const parent = entries.get(entry.parentSourceLocalId);
        if (
          !parent ||
          parent.parentSourceLocalId ||
          parent.context !== entry.context ||
          parent.rootStructuralDigest !== entry.rootStructuralDigest
        )
          fail();
      }
    },
  });
}

export function createMigrationFactReferenceValidator(): MigrationFactReferenceValidator {
  const sourceIdsByKind = new Map<FactStreamKind, Set<MigrationSourceLocalId>>(
    FACT_STREAM_KINDS.map((kind) => [kind, new Set<MigrationSourceLocalId>()]),
  );
  const conversationSourceLocalIds = new Set<MigrationSourceLocalId>();
  const commentGraph = createMigrationCommentGraphValidator();
  let finalized = false;

  return Object.freeze({
    add(recordValue) {
      if (finalized) fail();
      const record = parseMigrationFactRecord(recordValue);
      const sourceIds = sourceIdsByKind.get(record.kind);
      if (!sourceIds || sourceIds.has(record.sourceLocalId)) fail();

      if (record.kind === 'conversations') {
        sourceIds.add(record.sourceLocalId);
        conversationSourceLocalIds.add(record.sourceLocalId);
        return;
      }
      if (record.kind === 'messages' || record.kind === 'image_cache') {
        if (!conversationSourceLocalIds.has(record.conversationSourceLocalId)) fail();
        sourceIds.add(record.sourceLocalId);
        return;
      }
      if (record.kind === 'article_comments') {
        if (record.conversationSourceLocalId && !conversationSourceLocalIds.has(record.conversationSourceLocalId))
          fail();
        commentGraph.add(record);
        sourceIds.add(record.sourceLocalId);
        return;
      }
      sourceIds.add(record.sourceLocalId);
    },
    finalize() {
      if (finalized) fail();
      finalized = true;
      commentGraph.finalize();
    },
  });
}

export function encodeCanonicalJson(value: unknown): CanonicalJson {
  // ponytail: one record is bounded at 64 MiB; switch to an incremental JSON encoder only if that protocol ceiling must grow.
  const json = JSON.stringify(canonicalJsonValue(value));
  if (typeof json !== 'string') fail();
  const bytes = textEncoder.encode(json);
  assertMigrationRecordByteLength(bytes);
  return Object.freeze({ text: json, bytes });
}

export function decodeCanonicalJson(bytes: Uint8Array): JsonValue {
  if (!(bytes instanceof Uint8Array)) fail();
  assertMigrationRecordByteLength(bytes);
  let value: unknown;
  try {
    value = JSON.parse(strictTextDecoder.decode(bytes));
  } catch (_error) {
    fail();
  }
  const canonical = encodeCanonicalJson(value);
  if (!sameBytes(canonical.bytes, bytes)) fail();
  return canonicalJsonValue(value);
}

export function encodeMigrationFactRecord(recordValue: MigrationFactRecord): CanonicalJson {
  return encodeCanonicalJson(parseMigrationFactRecord(recordValue));
}

export function decodeMigrationFactRecord(bytes: Uint8Array): MigrationFactRecord {
  return parseMigrationFactRecord(decodeCanonicalJson(bytes));
}

function utf8CodePointByteLength(value: string, index: number): { byteLength: number; nextIndex: number } {
  const first = value.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) return { byteLength: 4, nextIndex: index + 2 };
  if (first <= 0x7f) return { byteLength: 1, nextIndex: index + 1 };
  if (first <= 0x7ff) return { byteLength: 2, nextIndex: index + 1 };
  return { byteLength: 3, nextIndex: index + 1 };
}

export function* splitCanonicalJsonText(
  canonical: CanonicalJson,
  maximumChunkBytes = MAX_CANONICAL_RECORD_JSON_CHUNK_BYTES,
): Generator<string> {
  if (
    !Number.isSafeInteger(maximumChunkBytes) ||
    maximumChunkBytes <= 0 ||
    maximumChunkBytes > MAX_CANONICAL_RECORD_JSON_CHUNK_BYTES
  ) {
    fail();
  }
  if (!canonical || typeof canonical.text !== 'string' || !(canonical.bytes instanceof Uint8Array)) fail();
  if (!sameBytes(textEncoder.encode(canonical.text), canonical.bytes)) fail();
  let start = 0;
  let index = 0;
  let currentBytes = 0;
  while (index < canonical.text.length) {
    const part = utf8CodePointByteLength(canonical.text, index);
    if (currentBytes && currentBytes + part.byteLength > maximumChunkBytes) {
      yield canonical.text.slice(start, index);
      start = index;
      currentBytes = 0;
    }
    currentBytes += part.byteLength;
    index = part.nextIndex;
  }
  if (start < canonical.text.length) yield canonical.text.slice(start);
}

export function compareMigrationCommentFacts(left: MigrationCommentFact, right: MigrationCommentFact): number {
  const leftRecord = parseMigrationFactRecord(left);
  const rightRecord = parseMigrationFactRecord(right);
  if (leftRecord.kind !== 'article_comments' || rightRecord.kind !== 'article_comments') fail();
  const leftStructure = encodeCanonicalJson(
    commentStructuralInput({
      context: leftRecord.archiveIdentity.context,
      payload: leftRecord.payload,
      role: leftRecord.archiveIdentity.role,
      rootStructuralDigest:
        leftRecord.archiveIdentity.role === 'reply' ? leftRecord.archiveIdentity.rootStructuralDigest : undefined,
    }),
  ).text;
  const rightStructure = encodeCanonicalJson(
    commentStructuralInput({
      context: rightRecord.archiveIdentity.context,
      payload: rightRecord.payload,
      role: rightRecord.archiveIdentity.role,
      rootStructuralDigest:
        rightRecord.archiveIdentity.role === 'reply' ? rightRecord.archiveIdentity.rootStructuralDigest : undefined,
    }),
  ).text;
  if (leftStructure !== rightStructure) return leftStructure < rightStructure ? -1 : 1;
  return sourceLocalIdToNumeric(leftRecord.sourceLocalId) - sourceLocalIdToNumeric(rightRecord.sourceLocalId);
}

export function decideMigrationCommentMerge(input: {
  incomingGroupCount: unknown;
  targetGroupCount: unknown;
}): MigrationCommentMergeDecision {
  const incomingGroupCount = parsePositiveSafeInteger(input.incomingGroupCount);
  const targetGroupCount = parseNonNegativeSafeInteger(input.targetGroupCount);
  if (incomingGroupCount === 1 && targetGroupCount === 1) return Object.freeze({ action: 'merge', diagnostic: null });
  const diagnostic =
    incomingGroupCount > 1 || targetGroupCount > 1
      ? Object.freeze({
          code: 'ambiguous_comment_signature' as const,
          incomingGroupCount,
          targetGroupCount,
        })
      : null;
  return Object.freeze({ action: 'insert', diagnostic });
}

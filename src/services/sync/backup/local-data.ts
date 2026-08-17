import {
  ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA,
  serializeArticleCommentArchive,
  validateArticleCommentArchiveDocument,
  type ArticleCommentsArchiveDocument,
  type CommentArchiveSerializationWarning,
} from '@services/comments/domain/comment-archive';
import { LocalDataContractError, MAX_ZIP_STREAM_BYTES } from '@services/local-data/contracts';
import { uniqueConversationKey } from '@services/local-data/facts-archive';
import { normalizeImageContentType, validateConversationBundle } from '@services/sync/backup/backup-utils';

export const BACKUP_PORTABLE_FACTS_VERSION = 1 as const;

export type BackupRecord = Record<string, any>;

export type BackupPortableBundle = Readonly<{
  schemaVersion: 1;
  conversation: BackupRecord;
  messages: BackupRecord[];
  syncMapping: BackupRecord | null;
}>;

export type BackupPortableImageAsset = Readonly<{
  assetId: number;
  uniqueKey: string;
  url: string;
  contentType: string;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
  bytes: Uint8Array | null;
}>;

export type BackupImageCacheMode = 'absent' | 'missing-index' | 'indexed';

export type BackupPortableFacts = Readonly<{
  version: typeof BACKUP_PORTABLE_FACTS_VERSION;
  bundles: BackupPortableBundle[];
  looseMappings: BackupRecord[];
  imageCacheMode: BackupImageCacheMode;
  imageAssets: BackupPortableImageAsset[];
  articleComments: ArticleCommentsArchiveDocument;
}>;

export type BackupPortableFactsBuildResult = Readonly<{
  facts: BackupPortableFacts;
  warnings: CommentArchiveSerializationWarning[];
}>;

export type BackupRawImageRow = Readonly<{
  record: BackupRecord;
  bytes: Uint8Array;
}>;

/** Returns a Blob-compatible view without copying normal ArrayBuffer-backed bytes. */
export function backupBytesForBlob(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(bytes instanceof Uint8Array)) fail();
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

export type BackupRawFacts = Readonly<{
  conversations: BackupRecord[];
  messages: BackupRecord[];
  syncMappings: BackupRecord[];
  imageCache: BackupRawImageRow[];
  articleComments: BackupRecord[];
}>;

export type ImportProgress = { done: number; total: number; stage: string };

export type ImportStats = {
  conversationsAdded: number;
  conversationsUpdated: number;
  messagesAdded: number;
  messagesUpdated: number;
  messagesSkipped: number;
  mappingsAdded: number;
  mappingsUpdated: number;
  commentsAdded: number;
  commentsUpdated: number;
  commentsSkipped: number;
  commentWarnings: string[];
  settingsApplied: number;
};

export type BackupFactsAdapter = Readonly<{
  exportFacts: () => Promise<BackupPortableFactsBuildResult>;
  importFacts: (facts: BackupPortableFacts, onProgress?: (progress: ImportProgress) => void) => Promise<ImportStats>;
}>;

export function createEmptyImportStats(): ImportStats {
  return {
    conversationsAdded: 0,
    conversationsUpdated: 0,
    messagesAdded: 0,
    messagesUpdated: 0,
    messagesSkipped: 0,
    mappingsAdded: 0,
    mappingsUpdated: 0,
    commentsAdded: 0,
    commentsUpdated: 0,
    commentsSkipped: 0,
    commentWarnings: [],
    settingsApplied: 0,
  };
}

export function parseImportStats(value: unknown): ImportStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  const expected = [
    'commentWarnings',
    'commentsAdded',
    'commentsSkipped',
    'commentsUpdated',
    'conversationsAdded',
    'conversationsUpdated',
    'mappingsAdded',
    'mappingsUpdated',
    'messagesAdded',
    'messagesSkipped',
    'messagesUpdated',
    'settingsApplied',
  ];
  if (Object.keys(input).sort().join('|') !== expected.sort().join('|')) fail();
  const numberField = (key: string) => {
    const number = Number(input[key]);
    if (!Number.isSafeInteger(number) || number < 0) fail();
    return number;
  };
  if (!Array.isArray(input.commentWarnings) || input.commentWarnings.some((item) => typeof item !== 'string')) fail();
  return {
    conversationsAdded: numberField('conversationsAdded'),
    conversationsUpdated: numberField('conversationsUpdated'),
    messagesAdded: numberField('messagesAdded'),
    messagesUpdated: numberField('messagesUpdated'),
    messagesSkipped: numberField('messagesSkipped'),
    mappingsAdded: numberField('mappingsAdded'),
    mappingsUpdated: numberField('mappingsUpdated'),
    commentsAdded: numberField('commentsAdded'),
    commentsUpdated: numberField('commentsUpdated'),
    commentsSkipped: numberField('commentsSkipped'),
    commentWarnings: [...(input.commentWarnings as string[])],
    settingsApplied: numberField('settingsApplied'),
  };
}

function fail(code: 'INVALID_ARGUMENT' | 'PAYLOAD_TOO_LARGE' = 'INVALID_ARGUMENT'): never {
  throw new LocalDataContractError(
    code,
    code === 'PAYLOAD_TOO_LARGE' ? { limitBytes: MAX_ZIP_STREAM_BYTES } : undefined,
  );
}

function positiveInt(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function finiteTimestamp(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

export function normalizeBackupHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeBackupConversationRecord(record: BackupRecord): BackupRecord {
  if (!record || typeof record !== 'object') return record;
  const existingListSourceKey = safeString(record.listSourceKey);
  const existingListSiteKey = safeString(record.listSiteKey);
  const source = safeString(record.source).toLowerCase();
  const nextListSourceKey = source || existingListSourceKey || 'unknown';
  const normalizedUrl = normalizeBackupHttpUrl(record.url);
  let derivedSiteKey = '';
  if (normalizedUrl) {
    try {
      const host = safeString(new URL(normalizedUrl).hostname).toLowerCase();
      if (host) derivedSiteKey = `domain:${host}`;
    } catch {
      derivedSiteKey = '';
    }
  }
  const nextListSiteKey = derivedSiteKey || existingListSiteKey || 'unknown';
  if (existingListSourceKey === nextListSourceKey && existingListSiteKey === nextListSiteKey) return record;
  return { ...record, listSourceKey: nextListSourceKey, listSiteKey: nextListSiteKey };
}

function stripLocalConversation(record: BackupRecord): BackupRecord {
  const value = record && typeof record === 'object' ? { ...record } : {};
  delete value.id;
  return value;
}

function stripLocalMessage(record: BackupRecord): BackupRecord {
  const value = record && typeof record === 'object' ? { ...record } : {};
  delete value.id;
  delete value.conversationId;
  return value;
}

function stripLocalMapping(record: BackupRecord): BackupRecord {
  const value = record && typeof record === 'object' ? { ...record } : {};
  delete value.id;
  return value;
}

function compareMessages(a: BackupRecord, b: BackupRecord): number {
  const aSequence = Number(a?.sequence);
  const bSequence = Number(b?.sequence);
  if (Number.isFinite(aSequence) && Number.isFinite(bSequence) && aSequence !== bSequence) {
    return aSequence - bSequence;
  }
  const aUpdatedAt = Number(a?.updatedAt) || 0;
  const bUpdatedAt = Number(b?.updatedAt) || 0;
  if (aUpdatedAt !== bUpdatedAt) return aUpdatedAt - bUpdatedAt;
  return String(a?.messageKey || '').localeCompare(String(b?.messageKey || ''));
}

export function buildPortableBackupFacts(input: BackupRawFacts): BackupPortableFactsBuildResult {
  const conversations = Array.isArray(input.conversations) ? input.conversations : [];
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const mappings = Array.isArray(input.syncMappings) ? input.syncMappings : [];
  const imageCache = Array.isArray(input.imageCache) ? input.imageCache : [];
  const articleComments = Array.isArray(input.articleComments) ? input.articleComments : [];

  const uniqueKeyByConversationId = new Map<number, string>();
  const messagesByConversationId = new Map<number, BackupRecord[]>();
  const mappingByUniqueKey = new Map<string, BackupRecord>();

  for (const conversation of conversations) {
    const id = positiveInt(conversation?.id);
    const uniqueKey = uniqueConversationKey(conversation);
    if (id && uniqueKey) uniqueKeyByConversationId.set(id, uniqueKey);
  }

  for (const message of messages) {
    const conversationId = positiveInt(message?.conversationId);
    if (!conversationId) continue;
    const list = messagesByConversationId.get(conversationId) || [];
    list.push(message);
    messagesByConversationId.set(conversationId, list);
  }

  for (const mapping of mappings) {
    const uniqueKey = uniqueConversationKey(mapping);
    if (!uniqueKey) continue;
    const existing = mappingByUniqueKey.get(uniqueKey);
    if (!existing || (Number(mapping?.updatedAt) || 0) > (Number(existing?.updatedAt) || 0)) {
      mappingByUniqueKey.set(uniqueKey, mapping);
    }
  }

  const bundles: BackupPortableBundle[] = [];
  for (const conversation of conversations) {
    const id = positiveInt(conversation?.id);
    const uniqueKey = uniqueConversationKey(conversation);
    if (!id || !uniqueKey) continue;
    const bundle: BackupPortableBundle = {
      schemaVersion: 1,
      conversation: stripLocalConversation(conversation),
      messages: (messagesByConversationId.get(id) || []).slice().sort(compareMessages).map(stripLocalMessage),
      syncMapping: mappingByUniqueKey.has(uniqueKey) ? stripLocalMapping(mappingByUniqueKey.get(uniqueKey)!) : null,
    };
    const validation = validateConversationBundle(bundle);
    if (!validation.ok) fail();
    bundles.push(bundle);
  }

  const imageAssets: BackupPortableImageAsset[] = [];
  for (const item of imageCache) {
    const record = item?.record;
    const bytes = item?.bytes;
    const assetId = positiveInt(record?.id);
    const conversationId = positiveInt(record?.conversationId);
    const uniqueKey = conversationId ? uniqueKeyByConversationId.get(conversationId) || '' : '';
    const url = String(record?.url || '').trim();
    const contentType = normalizeImageContentType(record?.contentType || '');
    if (!assetId || !uniqueKey || !url || !contentType.startsWith('image/') || !(bytes instanceof Uint8Array)) continue;
    if (bytes.byteLength <= 0) continue;
    imageAssets.push({
      assetId,
      uniqueKey,
      url,
      contentType,
      byteSize: bytes.byteLength,
      createdAt: finiteTimestamp(record?.createdAt),
      updatedAt: finiteTimestamp(record?.updatedAt),
      bytes,
    });
  }

  const serializedComments = serializeArticleCommentArchive(articleComments, uniqueKeyByConversationId);
  return {
    facts: {
      version: BACKUP_PORTABLE_FACTS_VERSION,
      bundles,
      looseMappings: [],
      imageCacheMode: 'indexed',
      imageAssets,
      articleComments: serializedComments.document,
    },
    warnings: serializedComments.warnings,
  };
}

const BACKUP_PORTABLE_CONTAINER_MAGIC = Uint8Array.from([0x53, 0x4e, 0x42, 0x4b, 0x50, 0x46, 0x30, 0x31]); // SNBKPF01
const BACKUP_PORTABLE_CONTAINER_HEADER_BYTES = BACKUP_PORTABLE_CONTAINER_MAGIC.byteLength + 4;

type BackupPortableImageMetadata = Omit<BackupPortableImageAsset, 'bytes'> &
  Readonly<{ payloadByteLength: number | null }>;

type BackupPortableContainerKind = 'facts' | 'export';

function parsePortableBundle(value: unknown): BackupPortableBundle {
  const validation = validateConversationBundle(value);
  if (!validation.ok) fail();
  const input = value as BackupPortableBundle;
  return {
    schemaVersion: 1,
    conversation: { ...input.conversation },
    messages: input.messages.map((message) => ({ ...message })),
    syncMapping: input.syncMapping ? { ...input.syncMapping } : null,
  };
}

function parsePortableImage(value: unknown): BackupPortableImageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  const expected = ['assetId', 'byteSize', 'bytes', 'contentType', 'createdAt', 'uniqueKey', 'updatedAt', 'url'];
  if (Object.keys(input).sort().join('|') !== expected.sort().join('|')) fail();
  const assetId = positiveInt(input.assetId);
  const uniqueKey = typeof input.uniqueKey === 'string' ? input.uniqueKey.trim() : '';
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const contentType = normalizeImageContentType(input.contentType);
  const byteSize = positiveInt(input.byteSize);
  const bytes = input.bytes === null ? null : input.bytes instanceof Uint8Array ? input.bytes : fail();
  if (!assetId || !uniqueKey || !uniqueKey.includes('||') || !url || !contentType.startsWith('image/') || !byteSize)
    fail();
  if (bytes && bytes.byteLength !== byteSize) fail();
  return {
    assetId,
    uniqueKey,
    url,
    contentType,
    byteSize,
    createdAt: finiteTimestamp(input.createdAt),
    updatedAt: finiteTimestamp(input.updatedAt),
    bytes,
  };
}

function portableFactsMetadata(facts: BackupPortableFacts) {
  return {
    version: facts.version,
    bundles: facts.bundles,
    looseMappings: facts.looseMappings,
    imageCacheMode: facts.imageCacheMode,
    imageAssets: facts.imageAssets.map(
      (asset): BackupPortableImageMetadata => ({
        assetId: asset.assetId,
        uniqueKey: asset.uniqueKey,
        url: asset.url,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        payloadByteLength: asset.bytes ? asset.bytes.byteLength : null,
      }),
    ),
    articleComments: facts.articleComments,
  };
}

function parsePortableImageMetadata(value: unknown): BackupPortableImageMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  const expected = [
    'assetId',
    'byteSize',
    'contentType',
    'createdAt',
    'payloadByteLength',
    'uniqueKey',
    'updatedAt',
    'url',
  ];
  if (Object.keys(input).sort().join('|') !== expected.sort().join('|')) fail();
  const assetId = positiveInt(input.assetId);
  const uniqueKey = typeof input.uniqueKey === 'string' ? input.uniqueKey.trim() : '';
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const contentType = normalizeImageContentType(input.contentType);
  const byteSize = positiveInt(input.byteSize);
  const payloadByteLength = input.payloadByteLength === null ? null : positiveInt(input.payloadByteLength);
  if (
    !assetId ||
    !uniqueKey ||
    !uniqueKey.includes('||') ||
    !url ||
    !contentType.startsWith('image/') ||
    !byteSize ||
    (input.payloadByteLength !== null && (!payloadByteLength || payloadByteLength !== byteSize))
  ) {
    fail();
  }
  return {
    assetId,
    uniqueKey,
    url,
    contentType,
    byteSize,
    createdAt: finiteTimestamp(input.createdAt),
    updatedAt: finiteTimestamp(input.updatedAt),
    payloadByteLength,
  };
}

function parseBackupWarnings(value: unknown): CommentArchiveSerializationWarning[] {
  if (!Array.isArray(value)) fail();
  return value.map((warning) => {
    if (!warning || typeof warning !== 'object' || Array.isArray(warning)) fail();
    const item = warning as Record<string, unknown>;
    const expected = item.commentId == null ? ['code'] : ['code', 'commentId'];
    if (Object.keys(item).sort().join('|') !== expected.sort().join('|')) fail();
    const code = String(item.code || '') as CommentArchiveSerializationWarning['code'];
    if (
      ![
        'invalid_row',
        'invalid_locator',
        'duplicate_id',
        'orphan_promoted',
        'cycle_normalized',
        'cross_context_promoted',
      ].includes(code)
    ) {
      fail();
    }
    const commentId = item.commentId == null ? undefined : positiveInt(item.commentId);
    if (item.commentId != null && !commentId) fail();
    return { code, ...(commentId ? { commentId } : {}) } as CommentArchiveSerializationWarning;
  });
}

function encodeBackupPortableContainer(
  kind: BackupPortableContainerKind,
  factsInput: BackupPortableFacts,
  warningsInput?: readonly CommentArchiveSerializationWarning[],
): Uint8Array {
  const facts = parseBackupPortableFacts(factsInput);
  const warnings = kind === 'export' ? parseBackupWarnings([...(warningsInput || [])]) : undefined;
  const metadata = {
    kind,
    facts: portableFactsMetadata(facts),
    ...(kind === 'export' ? { warnings } : {}),
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  let payloadBytes = 0;
  for (const asset of facts.imageAssets) {
    if (!asset.bytes) continue;
    payloadBytes += asset.bytes.byteLength;
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes > MAX_ZIP_STREAM_BYTES) fail('PAYLOAD_TOO_LARGE');
  }
  const totalBytes = BACKUP_PORTABLE_CONTAINER_HEADER_BYTES + metadataBytes.byteLength + payloadBytes;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ZIP_STREAM_BYTES) fail('PAYLOAD_TOO_LARGE');

  const output = new Uint8Array(totalBytes);
  output.set(BACKUP_PORTABLE_CONTAINER_MAGIC, 0);
  new DataView(output.buffer).setUint32(BACKUP_PORTABLE_CONTAINER_MAGIC.byteLength, metadataBytes.byteLength, true);
  output.set(metadataBytes, BACKUP_PORTABLE_CONTAINER_HEADER_BYTES);
  let offset = BACKUP_PORTABLE_CONTAINER_HEADER_BYTES + metadataBytes.byteLength;
  for (const asset of facts.imageAssets) {
    if (!asset.bytes) continue;
    output.set(asset.bytes, offset);
    offset += asset.bytes.byteLength;
  }
  if (offset !== output.byteLength) fail();
  return output;
}

function decodeBackupPortableContainer(
  bytes: Uint8Array,
  expectedKind: BackupPortableContainerKind,
): Readonly<{ facts: BackupPortableFacts; warnings: CommentArchiveSerializationWarning[] }> {
  if (!(bytes instanceof Uint8Array)) fail();
  if (bytes.byteLength > MAX_ZIP_STREAM_BYTES) fail('PAYLOAD_TOO_LARGE');
  if (bytes.byteLength < BACKUP_PORTABLE_CONTAINER_HEADER_BYTES) fail();
  for (let index = 0; index < BACKUP_PORTABLE_CONTAINER_MAGIC.byteLength; index += 1) {
    if (bytes[index] !== BACKUP_PORTABLE_CONTAINER_MAGIC[index]) fail();
  }
  const metadataByteLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    BACKUP_PORTABLE_CONTAINER_MAGIC.byteLength,
    true,
  );
  const metadataEnd = BACKUP_PORTABLE_CONTAINER_HEADER_BYTES + metadataByteLength;
  if (metadataByteLength <= 0 || metadataEnd > bytes.byteLength) fail();

  let metadata: unknown;
  try {
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(BACKUP_PORTABLE_CONTAINER_HEADER_BYTES, metadataEnd),
      ),
    );
  } catch {
    fail();
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail();
  const container = metadata as Record<string, unknown>;
  const expectedContainerKeys = expectedKind === 'export' ? ['facts', 'kind', 'warnings'] : ['facts', 'kind'];
  if (
    Object.keys(container).sort().join('|') !== expectedContainerKeys.sort().join('|') ||
    container.kind !== expectedKind
  )
    fail();
  if (!container.facts || typeof container.facts !== 'object' || Array.isArray(container.facts)) fail();
  const factsMetadata = container.facts as Record<string, unknown>;
  const expectedFactsKeys = ['articleComments', 'bundles', 'imageAssets', 'imageCacheMode', 'looseMappings', 'version'];
  if (
    Object.keys(factsMetadata).sort().join('|') !== expectedFactsKeys.sort().join('|') ||
    !Array.isArray(factsMetadata.imageAssets)
  ) {
    fail();
  }

  let payloadOffset = metadataEnd;
  const imageAssets = factsMetadata.imageAssets.map((value) => {
    const asset = parsePortableImageMetadata(value);
    if (asset.payloadByteLength === null) return { ...asset, bytes: null, payloadByteLength: undefined };
    const payloadEnd = payloadOffset + asset.payloadByteLength;
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > bytes.byteLength) fail();
    const payload = bytes.subarray(payloadOffset, payloadEnd);
    payloadOffset = payloadEnd;
    return { ...asset, bytes: payload, payloadByteLength: undefined };
  });
  if (payloadOffset !== bytes.byteLength) fail();

  const facts = parseBackupPortableFacts({
    ...factsMetadata,
    imageAssets: imageAssets.map(({ payloadByteLength: _payloadByteLength, ...asset }) => asset),
  });
  const warnings = expectedKind === 'export' ? parseBackupWarnings(container.warnings) : [];
  return { facts, warnings };
}

export function encodeBackupPortableFacts(facts: BackupPortableFacts): Uint8Array {
  return encodeBackupPortableContainer('facts', facts);
}

export function encodeBackupPortableExport(value: BackupPortableFactsBuildResult): Uint8Array {
  return encodeBackupPortableContainer('export', value.facts, value.warnings);
}

export function decodeBackupPortableExport(bytes: Uint8Array): BackupPortableFactsBuildResult {
  return decodeBackupPortableContainer(bytes, 'export');
}

export function decodeBackupPortableFacts(bytes: Uint8Array): BackupPortableFacts {
  return decodeBackupPortableContainer(bytes, 'facts').facts;
}

export function parseBackupPortableFacts(value: unknown): BackupPortableFacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  const expected = ['articleComments', 'bundles', 'imageAssets', 'imageCacheMode', 'looseMappings', 'version'];
  if (Object.keys(input).sort().join('|') !== expected.sort().join('|')) fail();
  if (input.version !== BACKUP_PORTABLE_FACTS_VERSION) fail();
  if (!Array.isArray(input.bundles) || !Array.isArray(input.looseMappings) || !Array.isArray(input.imageAssets)) fail();
  if (!['absent', 'missing-index', 'indexed'].includes(String(input.imageCacheMode))) fail();
  const commentValidation = validateArticleCommentArchiveDocument(input.articleComments);
  if (!commentValidation.ok || !commentValidation.document) fail();
  return {
    version: BACKUP_PORTABLE_FACTS_VERSION,
    bundles: input.bundles.map(parsePortableBundle),
    looseMappings: input.looseMappings.map((mapping) => {
      if (
        !mapping ||
        typeof mapping !== 'object' ||
        Array.isArray(mapping) ||
        !uniqueConversationKey(mapping as BackupRecord)
      )
        fail();
      return { ...(mapping as BackupRecord) };
    }),
    imageCacheMode: input.imageCacheMode as BackupImageCacheMode,
    imageAssets: input.imageAssets.map(parsePortableImage),
    articleComments: commentValidation.document,
  };
}

export function emptyPortableBackupFacts(): BackupPortableFacts {
  return {
    version: BACKUP_PORTABLE_FACTS_VERSION,
    bundles: [],
    looseMappings: [],
    imageCacheMode: 'absent',
    imageAssets: [],
    articleComments: { schemaVersion: ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA, comments: [] },
  };
}

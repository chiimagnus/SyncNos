import { LocalDataContractError } from '@services/local-data/contracts';
import type { Conversation, ConversationMessage } from '@services/conversations/domain/models';
import type { CaptureMessageMergePolicy } from '@services/shared/capture-integrity';

import { mapSqliteError } from './database';
import {
  canonicalJsonRecord,
  canonicalJsonText,
  positiveId,
  readCanonicalJsonRecord,
  safeString,
  type JsonRecord,
} from './fact-payload';
import { runFactsTransaction } from './revision';
import type { SyncNosSqliteDatabase } from './schema';

type MessageRow = Readonly<{
  id: number;
  conversation_id: number;
  message_key: string;
  role: string;
  author_name: string;
  content_text: string;
  content_markdown: string;
  sequence: number;
  updated_at: number;
  payload_json: string;
}>;

type ConversationTailRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  source_type: string;
  title: string;
  url: string;
  author: string;
  published_at: string;
  list_source_key: string;
  list_site_key: string;
  last_captured_at: number;
  notion_page_id: string;
  feishu_doc_id: string;
  payload_json: string;
}>;

export type MessagePersistenceMode = 'snapshot' | 'incremental' | 'append';

export type MessagePersistenceOptions = Readonly<{
  diff?: Readonly<{ added?: string[]; removed?: string[]; updated?: string[] }> | null;
  mode?: MessagePersistenceMode;
}>;

export type MessagePersistenceResult = Readonly<{
  deleted: number;
  upserted: number;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

function truthyText(value: unknown): string {
  return value ? String(value).trim() : '';
}

function normalizedTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizedSequence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function asMessage(row: MessageRow): ConversationMessage {
  const payload = readCanonicalJsonRecord(row.payload_json);
  return {
    ...payload,
    id: row.id,
    conversationId: row.conversation_id,
    messageKey: row.message_key,
    role: row.role,
    authorName: row.author_name,
    contentText: row.content_text,
    contentMarkdown: row.content_markdown,
    sequence: row.sequence,
    updatedAt: row.updated_at,
  } as ConversationMessage;
}

function asConversation(row: ConversationTailRow): Conversation {
  const payload = readCanonicalJsonRecord(row.payload_json);
  return {
    ...payload,
    id: row.id,
    sourceType: row.source_type,
    source: row.source,
    conversationKey: row.conversation_key,
    title: row.title,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at,
    listSourceKey: row.list_source_key,
    listSiteKey: row.list_site_key,
    lastCapturedAt: row.last_captured_at,
    notionPageId: row.notion_page_id,
    feishuDocId: row.feishu_doc_id,
  } as Conversation;
}

function selectMessageByConversationAndKey(
  database: SyncNosSqliteDatabase,
  conversationId: number,
  messageKey: string,
): MessageRow | null {
  return (
    (database
      .prepare('SELECT * FROM messages WHERE conversation_id = ? AND message_key = ?')
      .get(conversationId, messageKey) as MessageRow | undefined) ?? null
  );
}

function conversationExists(database: SyncNosSqliteDatabase, conversationId: number): boolean {
  return Boolean(database.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(conversationId));
}

function removeTransientMessageFields(payload: JsonRecord): JsonRecord {
  delete (payload as Record<string, unknown>).id;
  delete (payload as Record<string, unknown>).conversationId;
  delete (payload as Record<string, unknown>).captureMergePolicy;
  delete (payload as Record<string, unknown>).captureSequencePolicy;
  return payload;
}

function messagePayload(raw: unknown): JsonRecord {
  return removeTransientMessageFields(
    canonicalJsonRecord(raw, ['id', 'conversationId', 'captureMergePolicy', 'captureSequencePolicy']),
  );
}

function mergePolicy(value: unknown): CaptureMessageMergePolicy {
  return value === 'preserve-existing-markdown' || value === 'preserve-existing-content' ? value : 'replace';
}

function upsertMessageWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    conversationId: number;
    existing: MessageRow | null;
    raw: Record<string, unknown>;
    sequence: number;
  }>,
): void {
  const payload = messagePayload(input.raw);
  const existingPayload = input.existing ? readCanonicalJsonRecord(input.existing.payload_json) : {};
  const policy = mergePolicy(input.raw.captureMergePolicy);
  const preserveExistingContent = policy === 'preserve-existing-content' && Boolean(input.existing);
  const incomingMarkdown = truthyText(input.raw.contentMarkdown) ? String(input.raw.contentMarkdown) : '';
  const preserveExistingMarkdown =
    Boolean(input.existing) &&
    (policy === 'preserve-existing-content' || policy === 'preserve-existing-markdown') &&
    Boolean(safeString(input.existing?.content_markdown));
  const role = truthyText(input.raw.role) || 'assistant';
  const authorName = truthyText(input.raw.authorName) || input.existing?.author_name || '';
  const contentText = preserveExistingContent
    ? input.existing?.content_text || ''
    : (input.raw.contentText as any) || '';
  const contentMarkdown = preserveExistingMarkdown ? input.existing?.content_markdown || '' : incomingMarkdown;
  const updatedAt = preserveExistingContent
    ? normalizedTimestamp(input.existing?.updated_at)
    : normalizedTimestamp(input.raw.updatedAt);
  const messageKey = safeString(input.raw.messageKey);
  if (!messageKey) invalidArgument();

  const nextPayload: Record<string, unknown> = {
    ...existingPayload,
    ...payload,
    messageKey,
    role,
    authorName,
    contentText,
    contentMarkdown,
    sequence: input.sequence,
    updatedAt,
  };
  if (input.existing) {
    database
      .prepare(
        `UPDATE messages
            SET role = ?, author_name = ?, content_text = ?, content_markdown = ?, sequence = ?, updated_at = ?, payload_json = ?
          WHERE id = ?`,
      )
      .run(
        role,
        authorName,
        contentText,
        contentMarkdown,
        input.sequence,
        updatedAt,
        canonicalJsonText(nextPayload),
        input.existing.id,
      );
    return;
  }
  database
    .prepare(
      `INSERT INTO messages (
         conversation_id, message_key, role, author_name, content_text, content_markdown, sequence, updated_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      messageKey,
      role,
      authorName,
      contentText,
      contentMarkdown,
      input.sequence,
      updatedAt,
      canonicalJsonText(nextPayload),
    );
}

function assertRawMessage(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function syncMessagesWithinTransaction(
  database: SyncNosSqliteDatabase,
  conversationId: number,
  rawMessages: unknown,
  options: MessagePersistenceOptions | undefined,
): MessagePersistenceResult {
  const requestedMode = options?.mode;
  if (
    requestedMode !== undefined &&
    requestedMode !== 'snapshot' &&
    requestedMode !== 'incremental' &&
    requestedMode !== 'append'
  ) {
    invalidArgument();
  }
  const mode = requestedMode ?? 'snapshot';
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  const diff = options?.diff ?? null;

  if (mode !== 'snapshot') {
    const byKey = new Map<string, Record<string, unknown>>();
    for (const raw of messages) {
      const message = assertRawMessage(raw);
      const key = message?.messageKey ? String(message.messageKey).trim() : '';
      if (!key || !message) continue;
      byKey.set(key, message);
    }
    const requestedKeys = [...new Set([...normalizeKeys(diff?.added), ...normalizeKeys(diff?.updated)])];
    const requestedKeySet = new Set(requestedKeys);
    const removedKeys = mode === 'incremental' ? normalizeKeys(diff?.removed) : [];
    const hasEffectiveDiff =
      Boolean(diff) &&
      (mode === 'append' ? requestedKeys.length > 0 : requestedKeys.length > 0 || removedKeys.length > 0);
    if (!hasEffectiveDiff) return Object.freeze({ upserted: 0, deleted: 0 });

    const upsertKeys = [...byKey.keys()].filter((key) => requestedKeySet.has(key));
    const hasTailPolicy =
      mode === 'append' && upsertKeys.some((key) => byKey.get(key)?.captureSequencePolicy === 'preserve-existing-tail');
    const maxSequence = hasTailPolicy
      ? Number(
          (
            database
              .prepare('SELECT MAX(sequence) AS max_sequence FROM messages WHERE conversation_id = ?')
              .get(conversationId) as { max_sequence?: unknown } | undefined
          )?.max_sequence,
        )
      : Number.NaN;
    let nextTailSequence = Number.isFinite(maxSequence) ? maxSequence + 1 : 0;
    let upserted = 0;
    for (const key of upsertKeys) {
      const message = byKey.get(key);
      if (!message) continue;
      const existing = selectMessageByConversationAndKey(database, conversationId, key);
      const preserveSequence = mode === 'append' && message.captureSequencePolicy === 'preserve-existing-tail';
      const sequence = preserveSequence
        ? existing && Number.isFinite(existing.sequence)
          ? existing.sequence
          : nextTailSequence++
        : normalizedSequence(message.sequence);
      upsertMessageWithinTransaction(database, { conversationId, existing, raw: message, sequence });
      upserted += 1;
    }

    let deleted = 0;
    const deleteMessage = database.prepare('DELETE FROM messages WHERE id = ?');
    for (const key of removedKeys) {
      const existing = selectMessageByConversationAndKey(database, conversationId, key);
      if (!existing) continue;
      deleted += Number(deleteMessage.run(existing.id).changes) || 0;
    }
    return Object.freeze({ upserted, deleted });
  }

  const presentKeys = new Set<string>();
  let upserted = 0;
  for (const raw of messages) {
    const message = assertRawMessage(raw);
    if (!message || !message.messageKey) continue;
    const key = String(message.messageKey);
    presentKeys.add(key);
    const existing = selectMessageByConversationAndKey(database, conversationId, key);
    upsertMessageWithinTransaction(database, {
      conversationId,
      existing,
      raw: message,
      sequence: normalizedSequence(message.sequence),
    });
    upserted += 1;
  }
  const existingRows = database
    .prepare('SELECT id, message_key FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, id ASC')
    .all(conversationId) as Array<{ id: number; message_key: string }>;
  const deleteMessage = database.prepare('DELETE FROM messages WHERE id = ?');
  let deleted = 0;
  for (const row of existingRows) {
    if (presentKeys.has(row.message_key)) continue;
    deleted += Number(deleteMessage.run(row.id).changes) || 0;
  }
  return Object.freeze({ upserted, deleted });
}

export function deleteMessagesForConversationIds(database: SyncNosSqliteDatabase, values: readonly number[]): number {
  let deleted = 0;
  const statement = database.prepare('DELETE FROM messages WHERE conversation_id = ?');
  for (const id of values) deleted += Number(statement.run(id).changes) || 0;
  return deleted;
}

/** Moves only non-conflicting messages, matching IndexedDB's keep-wins duplicate policy. */
export function moveMessagesForConversationMerge(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ keepConversationId: number; removeConversationId: number }>,
): number {
  const rows = database
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, id ASC')
    .all(input.removeConversationId) as MessageRow[];
  const deleteMessage = database.prepare('DELETE FROM messages WHERE id = ?');
  const moveMessage = database.prepare('UPDATE messages SET conversation_id = ? WHERE id = ?');
  let moved = 0;
  for (const row of rows) {
    if (selectMessageByConversationAndKey(database, input.keepConversationId, row.message_key)) {
      deleteMessage.run(row.id);
      continue;
    }
    moveMessage.run(input.keepConversationId, row.id);
    moved += 1;
  }
  return moved;
}

function getMessagesByConversationId(database: SyncNosSqliteDatabase, value: unknown): ConversationMessage[] {
  const conversationId = positiveId(value);
  if (!conversationId) return [];
  return execute(() =>
    (
      database
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, id ASC')
        .all(conversationId) as MessageRow[]
    ).map(asMessage),
  );
}

function getMessagesTailByConversationId(
  database: SyncNosSqliteDatabase,
  value: unknown,
  limit: unknown,
): ConversationMessage[] {
  const conversationId = positiveId(value);
  const tailLimit = Number(limit);
  if (!conversationId || !Number.isFinite(tailLimit) || tailLimit <= 0) return [];
  return execute(() => {
    const rows = database
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence DESC, id DESC LIMIT ?')
      .all(conversationId, Math.floor(tailLimit)) as MessageRow[];
    return rows.sort((left, right) => left.sequence - right.sequence).map(asMessage);
  });
}

function getConversationTailWindowBySourceAndKey(
  database: SyncNosSqliteDatabase,
  source: unknown,
  conversationKey: unknown,
  limit: unknown,
): Readonly<{ conversation: Conversation | null; messages: ConversationMessage[] }> {
  const normalizedSource = safeString(source);
  const normalizedKey = safeString(conversationKey);
  if (!normalizedSource || !normalizedKey) return Object.freeze({ conversation: null, messages: [] });
  return execute(() => {
    const row = database
      .prepare('SELECT * FROM conversations WHERE source = ? AND conversation_key = ?')
      .get(normalizedSource, normalizedKey) as ConversationTailRow | undefined;
    if (!row) return Object.freeze({ conversation: null, messages: [] });
    return Object.freeze({
      conversation: asConversation(row),
      messages: getMessagesTailByConversationId(database, row.id, limit),
    });
  });
}

function syncConversationMessages(
  database: SyncNosSqliteDatabase,
  value: unknown,
  messages: unknown,
  options?: MessagePersistenceOptions,
): MessagePersistenceResult {
  const conversationId = positiveId(value);
  if (!conversationId) invalidArgument();
  const requestedMode = options?.mode;
  if (
    requestedMode !== undefined &&
    requestedMode !== 'snapshot' &&
    requestedMode !== 'incremental' &&
    requestedMode !== 'append'
  ) {
    invalidArgument();
  }
  const mode = requestedMode ?? 'snapshot';
  if (mode !== 'snapshot') {
    const diff = options?.diff ?? null;
    const requestedKeys = [...new Set([...normalizeKeys(diff?.added), ...normalizeKeys(diff?.updated)])];
    const removedKeys = mode === 'incremental' ? normalizeKeys(diff?.removed) : [];
    const hasEffectiveDiff =
      Boolean(diff) &&
      (mode === 'append' ? requestedKeys.length > 0 : requestedKeys.length > 0 || removedKeys.length > 0);
    if (!hasEffectiveDiff) return Object.freeze({ upserted: 0, deleted: 0 });
  }
  return execute(
    () =>
      runFactsTransaction(database, () => {
        if (!conversationExists(database, conversationId)) invalidArgument();
        return syncMessagesWithinTransaction(database, conversationId, messages, options);
      }).result,
  );
}

/** One SQLite handle hosts all message operations for the short-lived Host invocation. */
export function createMessagesRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    getConversationDetail: (conversationId: unknown) =>
      Object.freeze({
        conversationId: positiveId(conversationId) ?? 0,
        messages: getMessagesByConversationId(database, conversationId),
      }),
    getConversationTailWindowBySourceAndKey: (source: unknown, conversationKey: unknown, limit: unknown) =>
      getConversationTailWindowBySourceAndKey(database, source, conversationKey, limit),
    getMessagesByConversationId: (conversationId: unknown) => getMessagesByConversationId(database, conversationId),
    getMessagesTailByConversationId: (conversationId: unknown, limit: unknown) =>
      getMessagesTailByConversationId(database, conversationId, limit),
    syncConversationMessages: (conversationId: unknown, messages: unknown, options?: MessagePersistenceOptions) =>
      syncConversationMessages(database, conversationId, messages, options),
  });
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;

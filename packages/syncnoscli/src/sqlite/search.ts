import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  createSearchCursorBinding,
  LocalDataContractError,
  parseNormalizedSearchQuery,
  parsePlainSnippetHighlights,
  type LocalDataSearchFacet,
  type LocalDataSearchFacets,
  type LocalDataSearchPage,
  type LocalDataSearchResult,
  type LocalDataSearchSort,
  type NormalizedSearchQuery,
  type SearchCursorBinding,
  type SearchRequestPayload,
} from '@services/local-data/contracts';
import {
  LIST_SITE_KEY_ALL,
  LIST_SOURCE_KEY_ALL,
  normalizeConversationListQuery,
} from '@services/conversations/domain/list-query';

import { mapSqliteError } from './database';
import { readFactsRevision } from './revision';
import {
  getSqliteFtsCapability,
  SQLITE_FTS_TABLE_NAME,
  SQLITE_SCHEMA_VERSION,
  type SyncNosSqliteDatabase,
} from './schema';

const FALLBACK_CANDIDATE_LIMIT = 500;
const SEARCH_CURSOR_VERSION = 1;
const SEARCH_SNIPPET_TOKENS = 32;
const SEARCH_SNIPPET_CONTEXT = 120;

type SearchScope = Readonly<{
  siteKey: string;
  sourceKey: string;
}>;

type NormalizedSearchRequest = Readonly<{
  limit: number;
  query: NormalizedSearchQuery;
  scope: SearchScope;
  sort: LocalDataSearchSort;
}>;

type FtsSearchRequest = NormalizedSearchRequest &
  Readonly<{
    query: Extract<NormalizedSearchQuery, { mode: 'fts-phrase' }>;
  }>;

type FallbackSearchRequest = NormalizedSearchRequest &
  Readonly<{
    query: Extract<NormalizedSearchQuery, { mode: 'literal-fallback' }>;
  }>;

type SearchCursorAfter =
  | Readonly<{ id: number; kind: 'fts-best'; lastCapturedAt: number; score: number }>
  | Readonly<{ id: number; kind: 'fts-recent'; lastCapturedAt: number }>
  | Readonly<{ firstPosition: number; id: number; kind: 'fallback-best'; lastCapturedAt: number; titleHit: boolean }>
  | Readonly<{ id: number; kind: 'fallback-recent'; lastCapturedAt: number }>;

type SearchCursorToken = Readonly<{
  after: SearchCursorAfter;
  factsRevision: number;
  literal: string;
  mode: NormalizedSearchQuery['mode'];
  scanLimit: number | null;
  schemaVersion: number;
  siteKey: string;
  sort: LocalDataSearchSort;
  sourceKey: string;
  version: typeof SEARCH_CURSOR_VERSION;
}>;

type ConversationRow = Readonly<{
  conversation_key: unknown;
  id: unknown;
  last_captured_at: unknown;
  list_site_key: unknown;
  list_source_key: unknown;
  source: unknown;
  source_type: unknown;
  title: unknown;
  url: unknown;
}>;

type FtsResultRow = ConversationRow &
  Readonly<{
    marked_snippet: unknown;
    score: unknown;
  }>;

type SearchDocument = Readonly<{
  body: string;
  conversation: ReturnType<typeof parseConversationRow>;
}>;

type FallbackMatch = SearchDocument &
  Readonly<{
    bodyPosition: number;
    titlePosition: number;
  }>;

type FallbackCandidates = Readonly<{
  matches: readonly FallbackMatch[];
  truncated: boolean;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleCursor(): never {
  throw new LocalDataContractError('STALE_SEARCH_CURSOR');
}

function schemaMismatch(): never {
  throw new LocalDataContractError('SCHEMA_MISMATCH');
}

function ftsUnavailable(): never {
  throw new LocalDataContractError('FTS_UNAVAILABLE');
}

function isFtsReadFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && (code.startsWith('SQLITE_ERROR') || code.startsWith('SQLITE_CONSTRAINT'));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalidArgument();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidArgument();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidArgument();
  return value as Record<string, unknown>;
}

function safePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalidArgument();
  return Number(value);
}

function safeNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidArgument();
  return Number(value);
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) invalidArgument();
  return Number(value);
}

function safeFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidArgument();
  return value;
}

function safeText(value: unknown): string {
  if (typeof value !== 'string') invalidArgument();
  return value;
}

function normalizeSiteKey(value: unknown): string {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (!key || key === LIST_SITE_KEY_ALL) return LIST_SITE_KEY_ALL;
  if (key === 'unknown') return key;
  return key.startsWith('domain:') ? key : `domain:${key}`;
}

function normalizeRequest(input: SearchRequestPayload): NormalizedSearchRequest {
  const query = parseNormalizedSearchQuery(input.query);
  const listQuery = normalizeConversationListQuery({
    limit: input.limit,
    siteKey: input.siteKey,
    sourceKey: input.sourceKey,
  });
  const sourceKey = listQuery.sourceKey;
  const siteKey =
    sourceKey !== LIST_SOURCE_KEY_ALL && sourceKey !== 'web' ? LIST_SITE_KEY_ALL : normalizeSiteKey(listQuery.siteKey);
  const sort = input.sort ?? 'best';
  if (sort !== 'best' && sort !== 'recent') invalidArgument();
  return Object.freeze({
    limit: listQuery.limit,
    query,
    scope: Object.freeze({ siteKey, sourceKey }),
    sort,
  });
}

function filtersForScope(scope: SearchScope, tableAlias: string): Readonly<{ parameters: unknown[]; where: string[] }> {
  const parameters: unknown[] = [];
  const where: string[] = [];
  if (scope.sourceKey !== LIST_SOURCE_KEY_ALL) {
    where.push(`${tableAlias}.list_source_key = ?`);
    parameters.push(scope.sourceKey);
  }
  if (scope.siteKey !== LIST_SITE_KEY_ALL) {
    where.push(`${tableAlias}.list_site_key = ?`);
    parameters.push(scope.siteKey);
  }
  return Object.freeze({ parameters, where });
}

function scopeMatches(left: SearchScope, right: SearchScope): boolean {
  return left.sourceKey === right.sourceKey && left.siteKey === right.siteKey;
}

function parseConversationRow(row: ConversationRow) {
  const id = safePositiveInteger(row.id);
  const lastCapturedAt = safeInteger(row.last_captured_at);
  const source = safeText(row.source);
  const conversationKey = safeText(row.conversation_key);
  const sourceType = safeText(row.source_type);
  const title = safeText(row.title);
  const url = safeText(row.url);
  const siteKey = safeText(row.list_site_key);
  const sourceKey = safeText(row.list_source_key);
  if (!source || !conversationKey || !sourceKey || !siteKey) schemaMismatch();
  return Object.freeze({
    backendConversationId: id,
    conversationKey,
    lastCapturedAt,
    siteKey,
    source,
    sourceKey,
    sourceType,
    title,
    url,
  });
}

function cursorText(token: SearchCursorToken): string {
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
}

function decodedCursorText(token: string): SearchCursorToken {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) invalidArgument();
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.toString('base64url') !== token) invalidArgument();
  try {
    return parseCursorToken(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof LocalDataContractError) throw error;
    invalidArgument();
  }
}

function parseCursorAfter(value: unknown): SearchCursorAfter {
  const input = record(value);
  const kind = safeText(input.kind);
  if (kind === 'fts-best') {
    exactKeys(input, ['id', 'kind', 'lastCapturedAt', 'score']);
    return Object.freeze({
      id: safePositiveInteger(input.id),
      kind,
      lastCapturedAt: safeInteger(input.lastCapturedAt),
      score: safeFiniteNumber(input.score),
    });
  }
  if (kind === 'fts-recent') {
    exactKeys(input, ['id', 'kind', 'lastCapturedAt']);
    return Object.freeze({
      id: safePositiveInteger(input.id),
      kind,
      lastCapturedAt: safeInteger(input.lastCapturedAt),
    });
  }
  if (kind === 'fallback-best') {
    exactKeys(input, ['firstPosition', 'id', 'kind', 'lastCapturedAt', 'titleHit']);
    if (typeof input.titleHit !== 'boolean') invalidArgument();
    return Object.freeze({
      firstPosition: safePositiveInteger(input.firstPosition),
      id: safePositiveInteger(input.id),
      kind,
      lastCapturedAt: safeInteger(input.lastCapturedAt),
      titleHit: input.titleHit,
    });
  }
  if (kind === 'fallback-recent') {
    exactKeys(input, ['id', 'kind', 'lastCapturedAt']);
    return Object.freeze({
      id: safePositiveInteger(input.id),
      kind,
      lastCapturedAt: safeInteger(input.lastCapturedAt),
    });
  }
  invalidArgument();
}

function parseCursorToken(value: unknown): SearchCursorToken {
  const input = record(value);
  exactKeys(input, [
    'after',
    'factsRevision',
    'literal',
    'mode',
    'scanLimit',
    'schemaVersion',
    'siteKey',
    'sort',
    'sourceKey',
    'version',
  ]);
  if (input.version !== SEARCH_CURSOR_VERSION) invalidArgument();
  const mode = input.mode;
  if (mode !== 'fts-phrase' && mode !== 'literal-fallback') invalidArgument();
  const sort = input.sort;
  if (sort !== 'best' && sort !== 'recent') invalidArgument();
  const scanLimit = input.scanLimit;
  if (scanLimit !== null && scanLimit !== FALLBACK_CANDIDATE_LIMIT) invalidArgument();
  return Object.freeze({
    after: parseCursorAfter(input.after),
    factsRevision: safeNonNegativeInteger(input.factsRevision),
    literal: safeText(input.literal),
    mode,
    scanLimit,
    schemaVersion: safePositiveInteger(input.schemaVersion),
    siteKey: safeText(input.siteKey),
    sort,
    sourceKey: safeText(input.sourceKey),
    version: SEARCH_CURSOR_VERSION,
  });
}

function expectedCursorKind(request: NormalizedSearchRequest): SearchCursorAfter['kind'] {
  if (request.query.mode === 'fts-phrase') return request.sort === 'best' ? 'fts-best' : 'fts-recent';
  return request.sort === 'best' ? 'fallback-best' : 'fallback-recent';
}

function parseCursor(
  binding: SearchCursorBinding | undefined,
  request: NormalizedSearchRequest,
  factsRevision: number,
): SearchCursorToken | null {
  if (!binding) return null;
  if (binding.literal !== request.query.literal) staleCursor();
  const token = decodedCursorText(binding.token);
  if (
    token.factsRevision !== factsRevision ||
    token.literal !== request.query.literal ||
    token.mode !== request.query.mode ||
    token.schemaVersion !== SQLITE_SCHEMA_VERSION ||
    token.siteKey !== request.scope.siteKey ||
    token.sourceKey !== request.scope.sourceKey ||
    token.sort !== request.sort ||
    token.after.kind !== expectedCursorKind(request) ||
    token.scanLimit !== (request.query.mode === 'literal-fallback' ? FALLBACK_CANDIDATE_LIMIT : null)
  ) {
    staleCursor();
  }
  return token;
}

function nextCursor(
  request: NormalizedSearchRequest,
  factsRevision: number,
  after: SearchCursorAfter,
): SearchCursorBinding {
  return createSearchCursorBinding(
    request.query,
    cursorText({
      after,
      factsRevision,
      literal: request.query.literal,
      mode: request.query.mode,
      scanLimit: request.query.mode === 'literal-fallback' ? FALLBACK_CANDIDATE_LIMIT : null,
      schemaVersion: SQLITE_SCHEMA_VERSION,
      siteKey: request.scope.siteKey,
      sort: request.sort,
      sourceKey: request.scope.sourceKey,
      version: SEARCH_CURSOR_VERSION,
    }),
  );
}

function createSnippetMarkers(): Readonly<{ end: string; start: string }> {
  const nonce = randomUUID();
  return Object.freeze({ end: `\uE001${nonce}\uE000`, start: `\uE000${nonce}\uE001` });
}

function parseMarkedSnippet(
  value: unknown,
  markers: Readonly<{ end: string; start: string }>,
): Readonly<{ highlights: readonly { end: number; start: number }[]; snippet: string }> {
  if (typeof value !== 'string') schemaMismatch();
  const highlights: Array<{ end: number; start: number }> = [];
  let cursor = 0;
  let snippet = '';
  for (;;) {
    const markerStart = value.indexOf(markers.start, cursor);
    if (markerStart < 0) {
      snippet += value.slice(cursor);
      break;
    }
    snippet += value.slice(cursor, markerStart);
    const contentStart = markerStart + markers.start.length;
    const markerEnd = value.indexOf(markers.end, contentStart);
    if (markerEnd < 0) {
      snippet += value.slice(markerStart);
      break;
    }
    const start = snippet.length;
    snippet += value.slice(contentStart, markerEnd);
    if (snippet.length > start) highlights.push({ end: snippet.length, start });
    cursor = markerEnd + markers.end.length;
  }
  return Object.freeze({ highlights: parsePlainSnippetHighlights(snippet, highlights), snippet });
}

function sortFacets(items: LocalDataSearchFacet[]): readonly LocalDataSearchFacet[] {
  return Object.freeze(
    items.sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
    }),
  );
}

function facetsFromRows(rows: Array<Readonly<{ count?: unknown; key?: unknown }>>): readonly LocalDataSearchFacet[] {
  const items: LocalDataSearchFacet[] = [];
  for (const row of rows) {
    const key = safeText(row.key);
    const count = safePositiveInteger(row.count);
    items.push(Object.freeze({ key, label: key.startsWith('domain:') ? key.slice('domain:'.length) : key, count }));
  }
  return sortFacets(items);
}

function ftsFacets(
  database: SyncNosSqliteDatabase,
  query: Extract<NormalizedSearchQuery, { mode: 'fts-phrase' }>,
  scope: SearchScope,
): LocalDataSearchFacets {
  const readFacet = (column: 'list_site_key' | 'list_source_key', facetScope: SearchScope) => {
    const filters = filtersForScope(facetScope, 'c');
    return database
      .prepare(
        `SELECT c.${column} AS key, COUNT(*) AS count
           FROM ${SQLITE_FTS_TABLE_NAME}
           JOIN conversations c ON c.id = ${SQLITE_FTS_TABLE_NAME}.conversation_id
          WHERE ${SQLITE_FTS_TABLE_NAME} MATCH ?${filters.where.length ? ` AND ${filters.where.join(' AND ')}` : ''}
          GROUP BY c.${column}`,
      )
      .all(query.ftsPhrase, ...filters.parameters) as Array<Readonly<{ count?: unknown; key?: unknown }>>;
  };
  return Object.freeze({
    sites: facetsFromRows(readFacet('list_site_key', { ...scope, siteKey: LIST_SITE_KEY_ALL })),
    sources: facetsFromRows(readFacet('list_source_key', { ...scope, sourceKey: LIST_SOURCE_KEY_ALL })),
  });
}

function ftsAfterClause(
  after: SearchCursorAfter | null,
  sort: LocalDataSearchSort,
): Readonly<{ parameters: unknown[]; where: string }> {
  if (!after) return Object.freeze({ parameters: [], where: '' });
  if (sort === 'best') {
    if (after.kind !== 'fts-best') staleCursor();
    return Object.freeze({
      parameters: [after.score, after.score, after.lastCapturedAt, after.lastCapturedAt, after.id],
      where: 'WHERE (score > ? OR (score = ? AND (last_captured_at < ? OR (last_captured_at = ? AND id < ?))))',
    });
  }
  if (after.kind !== 'fts-recent') staleCursor();
  return Object.freeze({
    parameters: [after.lastCapturedAt, after.lastCapturedAt, after.id],
    where: 'WHERE (last_captured_at < ? OR (last_captured_at = ? AND id < ?))',
  });
}

function ftsResultRows(
  database: SyncNosSqliteDatabase,
  request: FtsSearchRequest,
  cursor: SearchCursorToken | null,
  markers: Readonly<{ end: string; start: string }>,
): FtsResultRow[] {
  const filters = filtersForScope(request.scope, 'c');
  const after = ftsAfterClause(cursor?.after ?? null, request.sort);
  const score = request.sort === 'best' ? `bm25(${SQLITE_FTS_TABLE_NAME}, 8.0, 1.0)` : 'NULL';
  const order =
    request.sort === 'best' ? 'score ASC, last_captured_at DESC, id DESC' : 'last_captured_at DESC, id DESC';
  const rows = database
    .prepare(
      `WITH matched AS (
         SELECT c.id, c.source, c.conversation_key, c.source_type, c.title, c.url, c.list_source_key, c.list_site_key,
                c.last_captured_at, ${score} AS score,
                snippet(${SQLITE_FTS_TABLE_NAME}, -1, ?, ?, '…', ${SEARCH_SNIPPET_TOKENS}) AS marked_snippet
           FROM ${SQLITE_FTS_TABLE_NAME}
           JOIN conversations c ON c.id = ${SQLITE_FTS_TABLE_NAME}.conversation_id
          WHERE ${SQLITE_FTS_TABLE_NAME} MATCH ?${filters.where.length ? ` AND ${filters.where.join(' AND ')}` : ''}
       )
       SELECT * FROM matched
       ${after.where}
       ORDER BY ${order}
       LIMIT ?`,
    )
    .all(
      markers.start,
      markers.end,
      request.query.ftsPhrase,
      ...filters.parameters,
      ...after.parameters,
      request.limit + 1,
    ) as FtsResultRow[];
  return rows;
}

function ftsResult(
  row: FtsResultRow,
  markers: Readonly<{ end: string; start: string }>,
  sort: LocalDataSearchSort,
): LocalDataSearchResult {
  const conversation = parseConversationRow(row);
  const parsedSnippet = parseMarkedSnippet(row.marked_snippet, markers);
  const score = sort === 'best' ? safeFiniteNumber(row.score) : null;
  return Object.freeze({
    backendConversationId: conversation.backendConversationId,
    conversationKey: conversation.conversationKey,
    highlights: parsedSnippet.highlights,
    lastCapturedAt: conversation.lastCapturedAt,
    score,
    siteKey: conversation.siteKey,
    snippet: parsedSnippet.snippet,
    source: conversation.source,
    sourceType: conversation.sourceType,
    title: conversation.title,
    url: conversation.url,
  });
}

function ftsAfterFromResult(row: FtsResultRow, sort: LocalDataSearchSort): SearchCursorAfter {
  const conversation = parseConversationRow(row);
  if (sort === 'best') {
    return Object.freeze({
      id: conversation.backendConversationId,
      kind: 'fts-best',
      lastCapturedAt: conversation.lastCapturedAt,
      score: safeFiniteNumber(row.score),
    });
  }
  return Object.freeze({
    id: conversation.backendConversationId,
    kind: 'fts-recent',
    lastCapturedAt: conversation.lastCapturedAt,
  });
}

function readFtsSearchPage(
  database: SyncNosSqliteDatabase,
  request: FtsSearchRequest,
  cursor: SearchCursorToken | null,
  factsRevision: number,
): LocalDataSearchPage {
  const markers = createSnippetMarkers();
  const rows = ftsResultRows(database, request, cursor, markers);
  const hasMore = rows.length > request.limit;
  const pageRows = hasMore ? rows.slice(0, request.limit) : rows;
  const tail = pageRows.at(-1);
  return Object.freeze({
    cursor: hasMore && tail ? nextCursor(request, factsRevision, ftsAfterFromResult(tail, request.sort)) : null,
    factsRevision,
    facets: ftsFacets(database, request.query, request.scope),
    hasMore,
    items: Object.freeze(pageRows.map((row) => ftsResult(row, markers, request.sort))),
    truncatedByScanLimit: false,
  });
}

function readSearchDocument(database: SyncNosSqliteDatabase, row: ConversationRow): SearchDocument {
  const conversation = parseConversationRow(row);
  const messages = database
    .prepare(
      `SELECT content_text, content_markdown
         FROM messages
        WHERE conversation_id = ?
        ORDER BY sequence ASC, id ASC`,
    )
    .all(conversation.backendConversationId) as Array<Readonly<{ content_markdown?: unknown; content_text?: unknown }>>;
  const body = messages
    .map((message) => {
      if (typeof message.content_text !== 'string' || typeof message.content_markdown !== 'string') schemaMismatch();
      return message.content_text || message.content_markdown;
    })
    .join('\n');
  return Object.freeze({ body, conversation });
}

function literalMatchesInSqlite(
  database: SyncNosSqliteDatabase,
  title: string,
  body: string,
  literal: string,
): boolean {
  const row = database
    .prepare('SELECT instr(?, ?) AS title_position, instr(?, ?) AS body_position')
    .get(title, literal, body, literal) as Readonly<{ body_position?: unknown; title_position?: unknown }> | undefined;
  const titlePosition = safeNonNegativeInteger(row?.title_position);
  const bodyPosition = safeNonNegativeInteger(row?.body_position);
  return titlePosition > 0 || bodyPosition > 0;
}

function fallbackCandidates(database: SyncNosSqliteDatabase, scope: SearchScope, literal: string): FallbackCandidates {
  const filters = filtersForScope(scope, 'c');
  const rows = database
    .prepare(
      `SELECT c.id, c.source, c.conversation_key, c.source_type, c.title, c.url, c.list_source_key, c.list_site_key,
              c.last_captured_at
         FROM conversations c
        ${filters.where.length ? `WHERE ${filters.where.join(' AND ')}` : ''}
        ORDER BY c.last_captured_at DESC, c.id DESC
        LIMIT ?`,
    )
    .all(...filters.parameters, FALLBACK_CANDIDATE_LIMIT + 1) as ConversationRow[];
  const truncated = rows.length > FALLBACK_CANDIDATE_LIMIT;
  const matches: FallbackMatch[] = [];
  for (const row of rows.slice(0, FALLBACK_CANDIDATE_LIMIT)) {
    const document = readSearchDocument(database, row);
    if (!literalMatchesInSqlite(database, document.conversation.title, document.body, literal)) continue;
    // SQLite instr() is the bounded literal admission check. JavaScript offsets are
    // intentionally recomputed here because result highlights are UTF-16 code units.
    const titlePosition = document.conversation.title.indexOf(literal) + 1;
    const bodyPosition = document.body.indexOf(literal) + 1;
    if (!titlePosition && !bodyPosition) schemaMismatch();
    matches.push(Object.freeze({ ...document, bodyPosition, titlePosition }));
  }
  return Object.freeze({ matches: Object.freeze(matches), truncated });
}

function fallbackFacets(
  database: SyncNosSqliteDatabase,
  request: FallbackSearchRequest,
  current: FallbackCandidates,
): Readonly<{ facets: LocalDataSearchFacets; truncated: boolean }> {
  const sourceScope: SearchScope = { ...request.scope, sourceKey: LIST_SOURCE_KEY_ALL };
  const siteScope: SearchScope = { ...request.scope, siteKey: LIST_SITE_KEY_ALL };
  const sourceCandidates = scopeMatches(sourceScope, request.scope)
    ? current
    : fallbackCandidates(database, sourceScope, request.query.literal);
  const siteCandidates = scopeMatches(siteScope, request.scope)
    ? current
    : fallbackCandidates(database, siteScope, request.query.literal);
  const toFacets = (matches: readonly FallbackMatch[], key: 'siteKey' | 'sourceKey') => {
    const counts = new Map<string, number>();
    for (const match of matches) {
      const value = match.conversation[key];
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return sortFacets(
      [...counts].map(([facetKey, count]) =>
        Object.freeze({
          count,
          key: facetKey,
          label: facetKey.startsWith('domain:') ? facetKey.slice('domain:'.length) : facetKey,
        }),
      ),
    );
  };
  return Object.freeze({
    facets: Object.freeze({
      sites: toFacets(siteCandidates.matches, 'siteKey'),
      sources: toFacets(sourceCandidates.matches, 'sourceKey'),
    }),
    truncated: current.truncated || sourceCandidates.truncated || siteCandidates.truncated,
  });
}

function sortFallbackMatches(matches: readonly FallbackMatch[], sort: LocalDataSearchSort): FallbackMatch[] {
  return matches.slice().sort((left, right) => {
    if (sort === 'best') {
      const leftTitleHit = left.titlePosition > 0;
      const rightTitleHit = right.titlePosition > 0;
      if (leftTitleHit !== rightTitleHit) return leftTitleHit ? -1 : 1;
      const leftPosition = left.titlePosition || left.bodyPosition;
      const rightPosition = right.titlePosition || right.bodyPosition;
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    }
    if (left.conversation.lastCapturedAt !== right.conversation.lastCapturedAt) {
      return right.conversation.lastCapturedAt - left.conversation.lastCapturedAt;
    }
    return right.conversation.backendConversationId - left.conversation.backendConversationId;
  });
}

function fallbackIsAfter(match: FallbackMatch, after: SearchCursorAfter | null, sort: LocalDataSearchSort): boolean {
  if (!after) return true;
  if (sort === 'best') {
    if (after.kind !== 'fallback-best') staleCursor();
    const titleHit = match.titlePosition > 0;
    if (titleHit !== after.titleHit) return !titleHit;
    const position = match.titlePosition || match.bodyPosition;
    if (position !== after.firstPosition) return position > after.firstPosition;
  } else if (after.kind !== 'fallback-recent') {
    staleCursor();
  }
  if (match.conversation.lastCapturedAt !== after.lastCapturedAt) {
    return match.conversation.lastCapturedAt < after.lastCapturedAt;
  }
  return match.conversation.backendConversationId < after.id;
}

function utf16BoundaryBefore(value: string, offset: number): number {
  if (offset <= 0 || offset >= value.length) return Math.max(0, Math.min(offset, value.length));
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff ? offset - 1 : offset;
}

function utf16BoundaryAfter(value: string, offset: number): number {
  if (offset <= 0 || offset >= value.length) return Math.max(0, Math.min(offset, value.length));
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff ? offset + 1 : offset;
}

function literalSnippet(
  value: string,
  position: number,
  literal: string,
): Readonly<{ highlights: readonly { end: number; start: number }[]; snippet: string }> {
  const zeroBasedPosition = position - 1;
  const start = utf16BoundaryBefore(value, Math.max(0, zeroBasedPosition - SEARCH_SNIPPET_CONTEXT));
  const end = utf16BoundaryAfter(
    value,
    Math.min(value.length, zeroBasedPosition + literal.length + SEARCH_SNIPPET_CONTEXT),
  );
  const prefix = start > 0 ? '…' : '';
  const suffix = end < value.length ? '…' : '';
  const snippet = `${prefix}${value.slice(start, end)}${suffix}`;
  const highlightStart = prefix.length + zeroBasedPosition - start;
  const highlights = parsePlainSnippetHighlights(snippet, [
    { end: highlightStart + literal.length, start: highlightStart },
  ]);
  return Object.freeze({ highlights, snippet });
}

function fallbackResult(match: FallbackMatch, literal: string): LocalDataSearchResult {
  const text = match.titlePosition ? match.conversation.title : match.body;
  const position = match.titlePosition || match.bodyPosition;
  const snippet = literalSnippet(text, position, literal);
  return Object.freeze({
    backendConversationId: match.conversation.backendConversationId,
    conversationKey: match.conversation.conversationKey,
    highlights: snippet.highlights,
    lastCapturedAt: match.conversation.lastCapturedAt,
    score: null,
    siteKey: match.conversation.siteKey,
    snippet: snippet.snippet,
    source: match.conversation.source,
    sourceType: match.conversation.sourceType,
    title: match.conversation.title,
    url: match.conversation.url,
  });
}

function fallbackAfterFromMatch(match: FallbackMatch, sort: LocalDataSearchSort): SearchCursorAfter {
  if (sort === 'best') {
    return Object.freeze({
      firstPosition: match.titlePosition || match.bodyPosition,
      id: match.conversation.backendConversationId,
      kind: 'fallback-best',
      lastCapturedAt: match.conversation.lastCapturedAt,
      titleHit: match.titlePosition > 0,
    });
  }
  return Object.freeze({
    id: match.conversation.backendConversationId,
    kind: 'fallback-recent',
    lastCapturedAt: match.conversation.lastCapturedAt,
  });
}

function readFallbackSearchPage(
  database: SyncNosSqliteDatabase,
  request: FallbackSearchRequest,
  cursor: SearchCursorToken | null,
  factsRevision: number,
): LocalDataSearchPage {
  const current = fallbackCandidates(database, request.scope, request.query.literal);
  const sorted = sortFallbackMatches(current.matches, request.sort).filter((match) =>
    fallbackIsAfter(match, cursor?.after ?? null, request.sort),
  );
  const hasMore = sorted.length > request.limit;
  const pageMatches = hasMore ? sorted.slice(0, request.limit) : sorted;
  const tail = pageMatches.at(-1);
  const facetData = fallbackFacets(database, request, current);
  return Object.freeze({
    cursor: hasMore && tail ? nextCursor(request, factsRevision, fallbackAfterFromMatch(tail, request.sort)) : null,
    factsRevision,
    facets: facetData.facets,
    hasMore,
    items: Object.freeze(pageMatches.map((match) => fallbackResult(match, request.query.literal))),
    truncatedByScanLimit: facetData.truncated,
  });
}

function readSearchPageInSnapshot(database: SyncNosSqliteDatabase, input: SearchRequestPayload): LocalDataSearchPage {
  const request = normalizeRequest(input);
  const factsRevision = readFactsRevision(database);
  const cursor = parseCursor(input.cursor, request, factsRevision);
  if (!getSqliteFtsCapability(database).available) ftsUnavailable();
  if (request.query.mode === 'fts-phrase') {
    const ftsRequest: FtsSearchRequest = { ...request, query: request.query };
    try {
      return readFtsSearchPage(database, ftsRequest, cursor, factsRevision);
    } catch (error) {
      if (isFtsReadFailure(error)) ftsUnavailable();
      throw error;
    }
  }
  const fallbackRequest: FallbackSearchRequest = { ...request, query: request.query };
  return readFallbackSearchPage(database, fallbackRequest, cursor, factsRevision);
}

function readSearchPage(database: SyncNosSqliteDatabase, input: SearchRequestPayload): LocalDataSearchPage {
  if (database.inTransaction) throw new LocalDataContractError('BUSY');
  return database.transaction(() => readSearchPageInSnapshot(database, input))();
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error, { readOnly: true });
  }
}

/** Search is read-only; any FTS repair remains restricted to schema/import/facts transactions. */
export function createSearchRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    searchConversations: (input: SearchRequestPayload) => execute(() => readSearchPage(database, input)),
  });
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;

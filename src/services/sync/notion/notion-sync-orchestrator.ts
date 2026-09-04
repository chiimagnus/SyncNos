import type { NotionServices } from '@services/sync/notion/notion-services.ts';
import { extractNotionWorkspaceSlugFromUrl } from '@services/sync/notion/notion-url-utils';
import { computeNewMessages, extractCursor, lastMessageCursor } from '@services/sync/notion/notion-sync-cursor.ts';
import { storageGet } from '@platform/storage/local';
import {
  buildNotionCommentsBlocks,
  computeNotionCommentsDigest,
} from '@services/comments/sync/notion-comments-renderer';
import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';
import { parseArticleCommentDtos, type ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { buildToggleHeadingBlock as buildNotionToggleHeadingBlock } from '@services/sync/notion/notion-section-blocks.ts';
import {
  ensureSectionHeadingBlockId,
  layoutSpecForConversationKind,
  rebuildSectionByArchivingHeading,
  recoverSectionHeadingBlockId,
} from '@services/sync/notion/notion-managed-sections.ts';
import { normalizeStandaloneImageCaptionLines } from '@services/sync/shared/markdown-image-normalizer';
import { createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
import { createSyncRunOwnership } from '@services/sync/sync-run-ownership';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';
import type { SyncJobSnapshot } from '@services/sync/models';

const SYNC_PROVIDER = 'notion';
const SYNC_CONVERSATION_CONCURRENCY = 2;

function notionTraceEnabled() {
  try {
    return !!(globalThis as any).__SYNCNOS_NOTION_TRACE__;
  } catch (_e) {
    return false;
  }
}

function createConversationTrace(conversationId: unknown) {
  const enabled = notionTraceEnabled();
  const startedAt = Date.now();
  let lastAt = startedAt;
  const stages: any[] = [];

  function mark(stage: unknown) {
    if (!enabled) return;
    const now = Date.now();
    stages.push({
      stage: String(stage || 'unknown'),
      elapsedMs: now - startedAt,
      sinceLastMs: now - lastAt,
    });
    lastAt = now;
  }

  function flush(meta: any = {}) {
    if (!enabled || !stages.length) return;
    try {
      console.debug('[SyncNos][NotionTrace]', {
        conversationId: Number(conversationId) || 0,
        totalMs: Date.now() - startedAt,
        stages: stages.slice(),
        ...meta,
      });
    } catch (_e) {
      // ignore debug logging failures
    }
  }

  return { mark, flush };
}

function toConvoLabel(convo: any): string {
  if (!convo) return '(missing conversation)';
  const t = convo.title || '';
  return t ? `"${t}"` : `conversation#${convo.id || '?'}`;
}

function isObjectNotFoundError(error: unknown): boolean {
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  if (!message) return false;
  return message.includes('object_not_found');
}

function isMissingDatabaseError(error: unknown): boolean {
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  if (!message) return false;
  if (!isObjectNotFoundError(error)) return false;
  return message.toLowerCase().includes('database');
}

function buildJobPersistenceError(): Error {
  return Object.assign(new Error('notion sync job persistence failed'), { code: 'notion_sync_job_persist_failed' });
}

function parseHttpStatus(error: unknown): number {
  const explicit = error && (error as any).status != null ? Number((error as any).status) : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : 0;
}

function parseNotionErrorCode(error: unknown): string {
  const explicit = String(error && (error as any).code ? (error as any).code : '').trim();
  if (explicit) return explicit.toLowerCase();
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  const codeMatch = message.match(/"code"\s*:\s*"([^"]+)"/i);
  return codeMatch
    ? String(codeMatch[1] || '')
        .trim()
        .toLowerCase()
    : '';
}

function parseNotionErrorMessage(error: unknown): string {
  const explicit = error && (error as any).notionMessage ? String((error as any).notionMessage) : '';
  if (explicit.trim()) return explicit.trim();
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  const apiMessageMatch = message.match(/"message"\s*:\s*"([^"]+)"/i);
  if (apiMessageMatch && apiMessageMatch[1]) {
    try {
      return JSON.parse(`"${apiMessageMatch[1]}"`);
    } catch (_e) {
      return String(apiMessageMatch[1]);
    }
  }
  return message;
}

function formatRetryHint(error: unknown): string {
  const retryAfterMs = error && (error as any).retryAfterMs != null ? Number((error as any).retryAfterMs) : 0;
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return '';
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return ` Retry in about ${seconds}s.`;
}

function normalizeNotionSyncError(error: unknown): string {
  const rawMessage =
    error && (error as any).message ? String((error as any).message) : String(error || 'unknown error');
  if (!rawMessage) return 'unknown error';
  if (!rawMessage.toLowerCase().includes('notion api failed:')) return rawMessage;

  const status = parseHttpStatus(error);
  const notionMessage = parseNotionErrorMessage(error)
    .replace(/^notion api failed:\s*/i, '')
    .trim();
  if (status === 429) {
    const retryHint = formatRetryHint(error);
    return `${notionMessage || rawMessage}${retryHint}`.trim();
  }
  return notionMessage || rawMessage;
}

function isStaleBlockAnchorError(error: unknown): boolean {
  const code = parseNotionErrorCode(error);
  if (code === 'object_not_found') return true;
  const msg = normalizeNotionSyncError(error).toLowerCase();
  if (!msg) return false;
  return msg.includes('archived') || msg.includes('in_trash');
}

function toCurrentConversationTitle(convo: any, _id?: unknown): string {
  const title = convo && convo.title ? String(convo.title).trim() : '';
  if (title) return title;
  return '';
}

function readRichText(items: unknown): string {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (item.plain_text != null) return String(item.plain_text);
      if (item.text && item.text.content != null) return String(item.text.content);
      return '';
    })
    .join('');
}

function normalizePagePropertyValue(property: any): string {
  const prop = property && typeof property === 'object' ? property : {};
  if (Array.isArray(prop.title)) return readRichText(prop.title);
  if (Array.isArray(prop.rich_text)) return readRichText(prop.rich_text);
  if (Array.isArray(prop.multi_select)) {
    return prop.multi_select
      .map((item: any) => String(item && item.name ? item.name : '').trim())
      .filter(Boolean)
      .sort()
      .join('|');
  }
  if (prop.date && typeof prop.date === 'object') return String(prop.date.start || '');
  if (prop.url != null) return String(prop.url || '');
  if (Object.prototype.hasOwnProperty.call(prop, 'number')) {
    if (prop.number == null) return '';
    const n = Number(prop.number);
    return Number.isFinite(n) ? String(n) : '';
  }
  return JSON.stringify(prop);
}

function pagePropertiesNeedUpdate(page: any, desiredProperties: any): boolean {
  const pageProperties = page && page.properties && typeof page.properties === 'object' ? page.properties : {};
  const desired = desiredProperties && typeof desiredProperties === 'object' ? desiredProperties : {};
  for (const [key, value] of Object.entries(desired)) {
    if (!Object.prototype.hasOwnProperty.call(pageProperties, key)) return true;
    if (normalizePagePropertyValue(pageProperties[key]) !== normalizePagePropertyValue(value)) return true;
  }
  return false;
}

function countExternalImageBlocks(blocks: unknown): number {
  const list = Array.isArray(blocks) ? blocks : [];
  let count = 0;
  for (const b of list) {
    if (!b || b.type !== 'image' || !b.image) continue;
    if (b.image.type === 'external') count += 1;
  }
  return count;
}

function countInlineImageOmittedPlaceholders(blocks: unknown): number {
  const list = Array.isArray(blocks) ? blocks : [];
  let count = 0;
  for (const b of list) {
    if (!b || b.type !== 'paragraph' || !b.paragraph) continue;
    const rt = Array.isArray(b.paragraph.rich_text) ? b.paragraph.rich_text : [];
    const text = rt
      .map((x: any) => (x && x.type === 'text' && x.text && x.text.content ? String(x.text.content) : ''))
      .join('');
    if (text.includes('[Image omitted: inline image')) count += 1;
  }
  return count;
}

async function buildBlocksForSync({
  notionSyncService,
  accessToken,
  source,
  messagesList,
  conversationId,
}: {
  notionSyncService: any;
  accessToken?: string;
  source?: unknown;
  messagesList?: any;
  conversationId: number;
}) {
  const warnings: any[] = [];
  let blocks = notionSyncService.messagesToBlocks(messagesList, {
    source,
  });
  blocks = await maybeUpgradeBlocksWithNotionFileUploads({
    notionSyncService,
    accessToken,
    blocks,
    warnings,
    conversationId,
  });
  return { blocks, warnings };
}

async function maybeUpgradeBlocksWithNotionFileUploads({
  notionSyncService,
  accessToken,
  blocks,
  warnings,
  conversationId,
}: {
  notionSyncService: any;
  accessToken?: string;
  blocks?: any;
  warnings: any[];
  conversationId: number;
}) {
  let nextBlocks = Array.isArray(blocks) ? blocks : [];
  if (!nextBlocks.length || typeof notionSyncService.upgradeImageBlocksToFileUploads !== 'function') return nextBlocks;
  if (
    typeof notionSyncService.hasExternalImageBlocks === 'function' &&
    !notionSyncService.hasExternalImageBlocks(nextBlocks)
  ) {
    return nextBlocks;
  }

  const externalBefore = countExternalImageBlocks(nextBlocks);
  nextBlocks = await notionSyncService.upgradeImageBlocksToFileUploads(accessToken, nextBlocks, conversationId);

  const externalAfter = countExternalImageBlocks(nextBlocks);
  if (externalBefore > 0 && externalAfter > 0) {
    warnings.push({
      code: 'notion_image_upload_degraded',
      message: `Some images could not be uploaded to Notion and were kept as external URLs (${externalAfter}/${externalBefore}).`,
      extra: { externalAfter, externalBefore },
    });
  }

  const inlineOmitted = countInlineImageOmittedPlaceholders(nextBlocks);
  if (inlineOmitted > 0) {
    warnings.push({
      code: 'notion_inline_image_upload_failed',
      message: `Some inline images could not be uploaded to Notion and were replaced with placeholder text (${inlineOmitted}).`,
      extra: { count: inlineOmitted },
    });
  }

  return nextBlocks;
}

function pickArticleBodyMessages(messagesList: unknown) {
  const list = Array.isArray(messagesList) ? messagesList : [];
  const preferred = list.filter((m) => m && String(m.messageKey || '').trim() === 'article_body');
  if (preferred.length) return preferred;
  return list;
}

function pickArticleBodyMarkdown(messagesList: unknown): string {
  const list = Array.isArray(messagesList) ? messagesList : [];
  const preferred = list.find((m) => m && String(m.messageKey || '').trim() === 'article_body');
  const picked =
    preferred ||
    list.find(
      (m) =>
        m &&
        String(m.role || '')
          .trim()
          .toLowerCase() === 'article',
    ) ||
    list[0] ||
    null;
  const markdown =
    picked && picked.contentMarkdown && String(picked.contentMarkdown).trim()
      ? String(picked.contentMarkdown)
      : String((picked && (picked.contentText || '')) || '');
  return String(markdown || '').trim();
}

function fnv1a32(input: unknown): string {
  const text = String(input || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function computeNotionArticleDigest(messagesList: unknown): string {
  const markdown = normalizeStandaloneImageCaptionLines(pickArticleBodyMarkdown(messagesList));
  return fnv1a32(JSON.stringify({ markdown }));
}

function stripLeadingArticleRoleHeading(blocks: unknown) {
  const list = Array.isArray(blocks) ? blocks.slice() : [];
  if (!list.length) return list;
  const first = list[0];
  if (!first || typeof first !== 'object') return list;
  if (first.type !== 'heading_3' || !first.heading_3 || !Array.isArray(first.heading_3.rich_text)) return list;
  const label = first.heading_3.rich_text.map((x: any) => String(x?.plain_text || x?.text?.content || '')).join('');
  if (
    String(label || '')
      .trim()
      .toLowerCase() !== 'article'
  )
    return list;
  return list.slice(1);
}

async function getNotionParentPageId() {
  const res = await storageGet(['notion_parent_page_id']);
  return String((res as any)?.notion_parent_page_id || '');
}

export function createNotionSyncOrchestrator(services: NotionServices) {
  const ownership = createSyncRunOwnership();
  const {
    jobStore: notionJobStore,
    tokenStore: notionTokenStore,
    dbManager: notionDbManager,
    syncService: notionSyncService,
    storage,
    conversationKinds,
  } = services;

  async function getSyncJobStatus() {
    return { provider: SYNC_PROVIDER, job: await notionJobStore.getJob() };
  }

  function clearSyncJobStatus() {
    return ownership.runExclusiveMutation(async () => {
      if (!(await notionJobStore.setJob(null))) throw buildJobPersistenceError();
      return { provider: SYNC_PROVIDER, job: null };
    });
  }

  function runExclusiveMaintenance<T>(mutation: () => Promise<T>): Promise<T> {
    return ownership.runExclusiveMutation(async () => {
      const result = await mutation();
      if (!(await notionJobStore.setJob(null))) throw buildJobPersistenceError();
      return result;
    });
  }

  function reconcileStartupSyncJob() {
    return ownership.runExclusiveMutation(() => notionJobStore.abortRunningJob());
  }

  async function runSyncConversations(input: any) {
    const instanceId = input && input.instanceId != null ? String(input.instanceId) : '';
    const ids = normalizeSyncConversationIds(input?.conversationIds);
    if (!ids.length) throw new Error('no conversationIds');

    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const jobStartedAt = Date.now();
    const initialJob: SyncJobSnapshot = {
      id: jobId,
      provider: SYNC_PROVIDER,
      instanceId,
      status: 'running',
      startedAt: jobStartedAt,
      updatedAt: jobStartedAt,
      finishedAt: null,
      totalCount: ids.length,
      conversationIds: [],
      currentConversationTitle: undefined,
      currentStage: ids.length ? 'preparing_queue' : '',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    if (!(await notionJobStore.setJob(initialJob))) throw buildJobPersistenceError();

    const lifecycle = createSyncJobLifecycle({
      initialJob,
      configuredConversationIds: ids,
      persist: (job) => notionJobStore.setJob(job),
    });

    try {
      const token = await notionTokenStore.getToken();
      const accessToken = token?.accessToken || '';
      if (!accessToken) throw new Error('notion not connected');

      const parentPageId = await getNotionParentPageId();
      if (!parentPageId) throw new Error('missing parentPageId');

      const dbIdByKindId = new Map();
      const dbIdPromiseByKindId = new Map();
      const recoveredMissingDbByStorageKey = new Set();
      const dbRecoveryPromiseByStorageKey = new Map();

      async function ensureDbForKind(kind: any) {
        const existing = dbIdByKindId.get(kind.id);
        if (existing) return String(existing);
        const pending = dbIdPromiseByKindId.get(kind.id);
        if (pending) return pending;
        const spec = kind && kind.notion && kind.notion.dbSpec ? kind.notion.dbSpec : null;
        if (!spec) throw new Error(`missing dbSpec for kind ${kind && kind.id ? kind.id : '?'}`);
        const dbPromise = (async () => {
          const db = await notionDbManager.ensureDatabase({
            accessToken: accessToken,
            parentPageId,
            dbSpec: spec,
          });
          const dbId = db && db.databaseId ? String(db.databaseId) : '';
          if (!dbId) throw new Error(`missing databaseId for kind ${kind.id}`);
          dbIdByKindId.set(kind.id, dbId);
          return dbId;
        })();
        dbIdPromiseByKindId.set(kind.id, dbPromise);
        try {
          return await dbPromise;
        } finally {
          dbIdPromiseByKindId.delete(kind.id);
        }
      }

      async function recoverDbForStorageKey(kind: any, dbSpec: any) {
        const storageKey = String(dbSpec && dbSpec.storageKey ? dbSpec.storageKey : '');
        const pending = dbRecoveryPromiseByStorageKey.get(storageKey);
        if (pending) return pending;
        const recoveryPromise = (async () => {
          await notionDbManager.clearCachedDatabaseId(storageKey);
          const rebuiltDb = await notionDbManager.ensureDatabase({
            accessToken: accessToken,
            parentPageId,
            dbSpec,
          });
          const rebuiltDbId = rebuiltDb && rebuiltDb.databaseId ? String(rebuiltDb.databaseId) : '';
          if (!rebuiltDbId) throw new Error(`missing databaseId for kind ${kind.id}`);
          dbIdByKindId.set(kind.id, rebuiltDbId);
          recoveredMissingDbByStorageKey.add(storageKey);
          return rebuiltDbId;
        })();
        dbRecoveryPromiseByStorageKey.set(storageKey, recoveryPromise);
        try {
          return await recoveryPromise;
        } finally {
          dbRecoveryPromiseByStorageKey.delete(storageKey);
        }
      }

      async function processConversation(id: number) {
        const trace = createConversationTrace(id);
        const warnings: any[] = [];
        let conversationTitle = '';

        try {
          trace.mark('load conversation');

          const mapped = await storage.getSyncMappingByConversation(id);
          const convo = mapped && mapped.conversation ? mapped.conversation : null;
          const mapping = mapped && mapped.mapping ? mapped.mapping : null;
          if (!convo) {
            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: false,
              error: 'conversation not found',
            });
            return;
          }
          conversationTitle = toCurrentConversationTitle(convo, id);
          await lifecycle.setItem(id, {
            conversationTitle,
            currentStage: 'preparing_sync',
          });

          const kind = conversationKinds.pick(convo);
          if (!kind) throw new Error(`no conversation kind for ${toConvoLabel(convo)}`);
          const dbSpec = kind && kind.notion && kind.notion.dbSpec ? kind.notion.dbSpec : null;
          const pageSpec = kind && kind.notion && kind.notion.pageSpec ? kind.notion.pageSpec : null;
          if (!dbSpec || !dbSpec.storageKey) throw new Error(`missing notion dbSpec for kind ${kind.id}`);
          if (!pageSpec) throw new Error(`missing notion pageSpec for kind ${kind.id}`);
          let articleCommentsLoaded = false;
          let articleCommentsLoadFailed = false;
          let articleCommentsSourceAvailable = false;
          let cachedArticleComments: ArticleCommentDto[] = [];
          const ensureArticleCommentsLoaded = async (failureMessage: string) => {
            if (articleCommentsLoaded) return cachedArticleComments;
            articleCommentsLoaded = true;
            articleCommentsLoadFailed = false;
            if (kind.id !== 'article') {
              cachedArticleComments = [];
              return cachedArticleComments;
            }
            if (storage && typeof storage.getArticleCommentsByConversationId === 'function') {
              articleCommentsSourceAvailable = true;
              try {
                const url = String(convo?.url || '').trim();
                if (url && typeof storage.attachOrphanArticleCommentsToConversation === 'function') {
                  await storage.attachOrphanArticleCommentsToConversation(url, id);
                }
                const loaded = await storage.getArticleCommentsByConversationId(id);
                cachedArticleComments = parseArticleCommentDtos(loaded);
              } catch (e) {
                articleCommentsLoadFailed = true;
                warnings.push({
                  code: 'notion_article_comments_fetch_failed',
                  message: String(failureMessage || 'Failed to load local article comments.'),
                  extra: { error: e && (e as any).message ? String((e as any).message) : String(e) },
                });
                cachedArticleComments = [];
              }
            } else {
              articleCommentsSourceAvailable = false;
              cachedArticleComments = [];
            }
            (convo as any).commentThreadCount = computeArticleCommentThreadCount(cachedArticleComments);
            return cachedArticleComments;
          };

          trace.mark('ensure database');
          let dbId = await ensureDbForKind(kind);

          const messages = await storage.getMessagesByConversationId(id);
          const cursorSectionId = kind && kind.id === 'chat' ? 'conversations' : null;
          const cursor = extractCursor(mapping, cursorSectionId);

          let pageId = '';
          if (mapping && mapping.notionPageId) pageId = String(mapping.notionPageId || '');
          if (!pageId && convo.notionPageId) pageId = String(convo.notionPageId || '');

          let pageUsable = false;
          let existingPage = null;
          if (pageId) {
            trace.mark('check destination page');
            try {
              const page = await notionSyncService.getPage(accessToken, pageId);
              existingPage = page;
              pageUsable = notionSyncService.isPageUsableForDatabase(page, dbId);
            } catch (_e) {
              pageUsable = false;
            }
            if (!pageUsable) pageId = '';
            if (pageUsable && existingPage && (existingPage as any).url) {
              const pageUrl = String((existingPage as any).url || '').trim();
              const slug = extractNotionWorkspaceSlugFromUrl(pageUrl);
              // Persist best-effort URL metadata for "Open in Notion" without requiring a re-create.
              if (pageUrl) {
                await storage
                  .setConversationNotionPageId(id, pageId, {
                    notionPageUrl: pageUrl,
                    ...(slug ? { notionWorkspaceSlug: slug } : null),
                  })
                  .catch(() => {});
              }
            }
          }

          if (!pageId) {
            let created = null;
            const createProperties =
              kind.id === 'article'
                ? (await ensureArticleCommentsLoaded(
                    'Failed to load local article comments; syncing article body only.',
                  ),
                  pageSpec.buildCreateProperties(convo))
                : pageSpec.buildCreateProperties(convo);
            trace.mark('create destination page');
            try {
              created = await notionSyncService.createPageInDatabase(accessToken, {
                databaseId: dbId,
                properties: createProperties,
                capturedAt: convo.lastCapturedAt,
              });
            } catch (createErr) {
              const shouldRecoverDb = isMissingDatabaseError(createErr);
              if (!shouldRecoverDb) throw createErr;
              const recoveredStorageKey = String(dbSpec.storageKey || '');
              trace.mark('rebuild database');
              // Rebuild once per storage key and share the recovery across concurrent conversations.

              dbId =
                recoveredMissingDbByStorageKey.has(recoveredStorageKey) && dbIdByKindId.get(kind.id)
                  ? String(dbIdByKindId.get(kind.id) || '')
                  : await recoverDbForStorageKey(kind, dbSpec);
              trace.mark('create destination page');

              created = await notionSyncService.createPageInDatabase(accessToken, {
                databaseId: dbId,
                properties: createProperties,
                capturedAt: convo.lastCapturedAt,
              });
            }
            pageId = created && created.id ? created.id : '';
            if (!pageId) throw new Error('create page failed');

            const createdUrl = created && created.url ? String(created.url) : '';
            const createdSlug = extractNotionWorkspaceSlugFromUrl(createdUrl);
            await storage.setConversationNotionPageId(id, pageId, {
              ...(createdUrl ? { notionPageUrl: createdUrl } : null),
              ...(createdSlug ? { notionWorkspaceSlug: createdSlug } : null),
            });

            trace.mark('build blocks');

            const layout = layoutSpecForConversationKind(kind.id);
            const sections = Array.isArray(layout?.sections) ? layout.sections : [];
            if (!sections.length) throw new Error('missing layout sections');

            const nextCursor = lastMessageCursor(messages);
            let appendedBlockCount = 0;

            if (kind.id === 'article') {
              const articleSection = sections.find((s) => s && String(s.id) === 'article');
              const commentsSection = sections.find((s) => s && String(s.id) === 'comments');
              if (!articleSection || !commentsSection) throw new Error('missing web article layout sections');

              const comments = await ensureArticleCommentsLoaded(
                'Failed to load local article comments; syncing article body only.',
              );
              const commentsDigest =
                !articleCommentsSourceAvailable || articleCommentsLoadFailed
                  ? null
                  : computeNotionCommentsDigest(Array.isArray(comments) ? comments : []);
              let commentThreads = 0;
              let commentItems = 0;

              const articleDigest = computeNotionArticleDigest(messages);

              const builtArticle = await buildBlocksForSync({
                notionSyncService,
                accessToken: accessToken,
                source: convo.source,
                messagesList: pickArticleBodyMessages(messages),
                conversationId: id,
              });
              const articleBlocks = stripLeadingArticleRoleHeading(
                Array.isArray(builtArticle?.blocks) ? builtArticle.blocks : [],
              );
              if (Array.isArray(builtArticle?.warnings) && builtArticle.warnings.length)
                warnings.push(...builtArticle.warnings);

              const builtComments = buildNotionCommentsBlocks(Array.isArray(comments) ? comments : []);
              const commentBlocks = Array.isArray(builtComments?.blocks) ? builtComments.blocks : [];
              commentThreads = Number(builtComments?.threads) || 0;
              commentItems = Number(builtComments?.items) || 0;

              trace.mark('create section headings');

              const headingRes = await notionSyncService.appendChildren(
                accessToken,
                pageId,
                sections.map((s) => buildNotionToggleHeadingBlock(s.title, s.level)),
              );
              const headingResults = Array.isArray(headingRes && headingRes.results) ? headingRes.results : [];
              const headingIdBySectionId: Record<string, string> = {};
              for (let i = 0; i < sections.length; i += 1) {
                const section = sections[i];
                const result = headingResults[i];
                const sectionId = section && section.id != null ? String(section.id) : '';
                const headingId = result && result.id ? String(result.id).trim() : '';
                if (sectionId && headingId) headingIdBySectionId[sectionId] = headingId;
              }

              const articleHeadingId = String(headingIdBySectionId.article || '').trim();
              const commentsHeadingId = String(headingIdBySectionId.comments || '').trim();
              if (!articleHeadingId || !commentsHeadingId) throw new Error('failed to create section headings');

              if (storage && typeof storage.patchSyncMapping === 'function') {
                await storage.patchSyncMapping(id, {
                  notionSections: {
                    article: { headingBlockId: articleHeadingId },
                    comments: { headingBlockId: commentsHeadingId },
                  },
                });
              }

              trace.mark('append children');
              if (articleBlocks.length) {
                await notionSyncService.appendChildren(accessToken, articleHeadingId, articleBlocks);
              }
              if (commentBlocks.length) {
                await notionSyncService.appendChildren(accessToken, commentsHeadingId, commentBlocks);
              }
              appendedBlockCount = sections.length + articleBlocks.length + commentBlocks.length;

              trace.mark('save cursor');

              await storage.setSyncCursor(id, {
                ...nextCursor,
                notionSectionDigests: {
                  article: { digest: String(articleDigest || ''), lastSyncedAt: Date.now() },
                  ...(typeof commentsDigest === 'string'
                    ? { comments: { digest: String(commentsDigest || ''), lastSyncedAt: Date.now() } }
                    : null),
                },
              });

              lifecycle.recordResult({
                conversationId: id,
                conversationTitle,
                ok: true,
                notionPageId: pageId,
                mode: 'created',
                appended: 0,
                warnings,
                comments: { updated: true, threads: commentThreads, items: commentItems },
              });
              trace.flush({ mode: 'created', ok: true, blockCount: appendedBlockCount });
              return;
            }

            const conversationsSection = sections.find((s) => s && String(s.id) === 'conversations') || sections[0];
            if (!conversationsSection) throw new Error('missing conversations section spec');

            const built = await buildBlocksForSync({
              notionSyncService,
              accessToken: accessToken,
              source: convo.source,
              messagesList: messages,
              conversationId: id,
            });
            const blocks = Array.isArray(built?.blocks) ? built.blocks : [];
            if (Array.isArray(built?.warnings) && built.warnings.length) warnings.push(...built.warnings);

            trace.mark('create section heading');

            const headingRes = await notionSyncService.appendChildren(accessToken, pageId, [
              buildNotionToggleHeadingBlock(conversationsSection.title, conversationsSection.level),
            ]);
            const headingResults = Array.isArray(headingRes && headingRes.results) ? headingRes.results : [];
            const conversationsHeadingId =
              headingResults[0] && headingResults[0].id ? String(headingResults[0].id).trim() : '';
            if (!conversationsHeadingId) throw new Error('failed to create conversations section');

            if (storage && typeof storage.patchSyncMapping === 'function') {
              await storage.patchSyncMapping(id, {
                notionSections: { conversations: { headingBlockId: conversationsHeadingId } },
              });
            }
            if (blocks.length) {
              trace.mark('append children');

              await notionSyncService.appendChildren(accessToken, conversationsHeadingId, blocks);
              appendedBlockCount = blocks.length + 1;
            }

            trace.mark('save cursor');

            await storage.setSyncCursor(id, {
              ...nextCursor,
              notionSectionCursors: {
                conversations: {
                  lastSyncedMessageKey: nextCursor.lastSyncedMessageKey,
                  lastSyncedSequence: nextCursor.lastSyncedSequence,
                  lastSyncedMessageUpdatedAt: nextCursor.lastSyncedMessageUpdatedAt,
                },
              },
            });

            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: true,
              notionPageId: pageId,
              mode: 'created',
              appended: messages.length,
              warnings,
            });
            trace.flush({ mode: 'created', ok: true, blockCount: appendedBlockCount });
            return;
          }

          if (kind.id === 'article') {
            await ensureArticleCommentsLoaded(
              'Failed to load local article comments; skipping comment sync in this run.',
            );
            const desiredProperties = pageSpec.buildUpdateProperties(convo);
            const needsPropertyUpdate = pagePropertiesNeedUpdate(existingPage, desiredProperties);
            if (needsPropertyUpdate) {
              trace.mark('update page properties');

              await notionSyncService.updatePageProperties(accessToken, {
                pageId,
                properties: desiredProperties,
              });
            }

            const layout = layoutSpecForConversationKind(kind.id);
            const articleSection = (layout.sections || []).find((s) => s && String(s.id) === 'article');
            const commentsSection = (layout.sections || []).find((s) => s && String(s.id) === 'comments');
            if (!articleSection || !commentsSection) throw new Error('missing web article layout sections');

            let articleDigest: string | null = null;
            try {
              articleDigest = computeNotionArticleDigest(messages);
            } catch (_e) {
              articleDigest = null;
            }
            const prevArticleDigest =
              mapping &&
              mapping.notionSectionDigests &&
              typeof mapping.notionSectionDigests === 'object' &&
              (mapping.notionSectionDigests as any).article &&
              typeof (mapping.notionSectionDigests as any).article === 'object' &&
              (mapping.notionSectionDigests as any).article.digest != null
                ? String((mapping.notionSectionDigests as any).article.digest || '')
                : '';
            const shouldUpdateArticle =
              typeof articleDigest === 'string' && String(articleDigest || '') !== prevArticleDigest;

            let articleComments: any[] = Array.isArray(cachedArticleComments) ? cachedArticleComments : [];
            let commentsDigest: string | null = null;
            let commentThreads = 0;
            let commentItems = 0;
            commentsDigest =
              !articleCommentsSourceAvailable || articleCommentsLoadFailed
                ? null
                : computeNotionCommentsDigest(Array.isArray(articleComments) ? articleComments : []);
            const prevCommentsDigest =
              mapping &&
              mapping.notionSectionDigests &&
              typeof mapping.notionSectionDigests === 'object' &&
              (mapping.notionSectionDigests as any).comments &&
              typeof (mapping.notionSectionDigests as any).comments === 'object' &&
              (mapping.notionSectionDigests as any).comments.digest != null
                ? String((mapping.notionSectionDigests as any).comments.digest || '')
                : '';
            const shouldUpdateComments =
              typeof commentsDigest === 'string' && String(commentsDigest || '') !== prevCommentsDigest;

            const mappingSections =
              mapping && mapping.notionSections && typeof mapping.notionSections === 'object'
                ? mapping.notionSections
                : {};
            const hasArticleAnchor = !!(mappingSections.article && mappingSections.article.headingBlockId);
            const hasCommentsAnchor = !!(mappingSections.comments && mappingSections.comments.headingBlockId);
            const shouldEnsureAnchors =
              (!hasArticleAnchor || !hasCommentsAnchor) && typeof storage.patchSyncMapping === 'function';

            let articleHeadingBlockId = hasArticleAnchor ? String(mappingSections.article.headingBlockId || '') : '';
            let commentsHeadingBlockId = hasCommentsAnchor ? String(mappingSections.comments.headingBlockId || '') : '';

            if (shouldEnsureAnchors) {
              trace.mark('ensure section anchors');
              const resolvedArticle = await ensureSectionHeadingBlockId({
                accessToken: accessToken,
                pageId,
                section: articleSection,
                mapping,
                notionSyncService,
                storage,
                conversationId: id,
              });
              articleHeadingBlockId = resolvedArticle.headingBlockId;
              const resolvedComments = await ensureSectionHeadingBlockId({
                accessToken: accessToken,
                pageId,
                section: commentsSection,
                mapping,
                notionSyncService,
                storage,
                conversationId: id,
              });
              commentsHeadingBlockId = resolvedComments.headingBlockId;
            }

            if (shouldUpdateArticle || shouldUpdateComments) {
              trace.mark('build web article blocks');
              let articleBlocks: any[] = [];
              let commentBlocks: any[] = [];

              if (shouldUpdateArticle) {
                const builtArticle = await buildBlocksForSync({
                  notionSyncService,
                  accessToken: accessToken,
                  source: convo.source,
                  messagesList: pickArticleBodyMessages(messages),
                  conversationId: id,
                });
                articleBlocks = stripLeadingArticleRoleHeading(
                  Array.isArray(builtArticle?.blocks) ? builtArticle.blocks : [],
                );
                if (Array.isArray(builtArticle?.warnings) && builtArticle.warnings.length) {
                  warnings.push(...builtArticle.warnings);
                }
              }
              if (shouldUpdateComments) {
                const builtComments = buildNotionCommentsBlocks(Array.isArray(articleComments) ? articleComments : []);
                commentBlocks = Array.isArray(builtComments?.blocks) ? builtComments.blocks : [];
                commentThreads = Number(builtComments?.threads) || 0;
                commentItems = Number(builtComments?.items) || 0;
              }

              if (shouldUpdateArticle) {
                if (!articleHeadingBlockId) {
                  const resolved = await ensureSectionHeadingBlockId({
                    accessToken: accessToken,
                    pageId,
                    section: articleSection,
                    mapping,
                    notionSyncService,
                    storage,
                    conversationId: id,
                  });
                  articleHeadingBlockId = resolved.headingBlockId;
                }
                trace.mark('rebuild article section');
                let rebuilt;
                try {
                  rebuilt = await rebuildSectionByArchivingHeading({
                    accessToken: accessToken,
                    pageId,
                    section: articleSection,
                    currentHeadingBlockId: articleHeadingBlockId,
                    desiredBlocks: articleBlocks,
                    notionSyncService,
                  });
                } catch (e) {
                  if (!isStaleBlockAnchorError(e)) throw e;
                  trace.mark('recover article rebuild');
                  rebuilt = await rebuildSectionByArchivingHeading({
                    accessToken: accessToken,
                    pageId,
                    section: articleSection,
                    currentHeadingBlockId: '',
                    desiredBlocks: articleBlocks,
                    notionSyncService,
                  });
                }
                articleHeadingBlockId = rebuilt.headingBlockId;
                if (storage && typeof storage.patchSyncMapping === 'function') {
                  await storage.patchSyncMapping(id, {
                    notionSections: { article: { headingBlockId: articleHeadingBlockId } },
                  });
                }
              }

              if (shouldUpdateComments) {
                if (!commentsHeadingBlockId) {
                  const resolved = await ensureSectionHeadingBlockId({
                    accessToken: accessToken,
                    pageId,
                    section: commentsSection,
                    mapping,
                    notionSyncService,
                    storage,
                    conversationId: id,
                  });
                  commentsHeadingBlockId = resolved.headingBlockId;
                }
                trace.mark('rebuild comments section');
                let rebuilt;
                try {
                  rebuilt = await rebuildSectionByArchivingHeading({
                    accessToken: accessToken,
                    pageId,
                    section: commentsSection,
                    currentHeadingBlockId: commentsHeadingBlockId,
                    desiredBlocks: commentBlocks,
                    notionSyncService,
                  });
                } catch (e) {
                  if (!isStaleBlockAnchorError(e)) throw e;
                  trace.mark('recover comments rebuild');
                  rebuilt = await rebuildSectionByArchivingHeading({
                    accessToken: accessToken,
                    pageId,
                    section: commentsSection,
                    currentHeadingBlockId: '',
                    desiredBlocks: commentBlocks,
                    notionSyncService,
                  });
                }
                commentsHeadingBlockId = rebuilt.headingBlockId;
                if (storage && typeof storage.patchSyncMapping === 'function') {
                  await storage.patchSyncMapping(id, {
                    notionSections: { comments: { headingBlockId: commentsHeadingBlockId } },
                  });
                }
              }
            }

            const nextCursor = lastMessageCursor(messages);
            trace.mark('save cursor');

            await storage.setSyncCursor(id, {
              ...nextCursor,
              ...(typeof articleDigest === 'string' || typeof commentsDigest === 'string'
                ? {
                    notionSectionDigests: {
                      ...(typeof articleDigest === 'string'
                        ? { article: { digest: String(articleDigest || ''), lastSyncedAt: Date.now() } }
                        : null),
                      ...(typeof commentsDigest === 'string'
                        ? { comments: { digest: String(commentsDigest || ''), lastSyncedAt: Date.now() } }
                        : null),
                    },
                  }
                : null),
            });

            const resultMode =
              shouldUpdateArticle || shouldUpdateComments
                ? 'rebuilt'
                : needsPropertyUpdate
                  ? 'updated_properties'
                  : 'no_changes';

            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: true,
              notionPageId: pageId,
              mode: resultMode,
              appended: 0,
              warnings,
              ...(shouldUpdateComments
                ? {
                    comments: {
                      updated: true,
                      threads: commentThreads,
                      items: commentItems,
                    },
                  }
                : null),
            });
            trace.flush({
              mode: resultMode,
              ok: true,
            });
            return;
          }

          const inc = computeNewMessages(messages, cursor);
          let shouldRebuild = !!inc.rebuild;
          const layout = layoutSpecForConversationKind(kind.id);
          const conversationsSection =
            (layout.sections || []).find((s) => s && String(s.id) === 'conversations') || layout.sections?.[0];
          if (!conversationsSection) throw new Error('missing conversations section spec');

          // Migrate legacy pages (no Conversations section anchor) by forcing a rebuild once,
          // so subsequent syncs can append under the section without scanning page children.
          // Also rebuild when local edits happen without new messages (append cannot fix historical edits).
          const mappingSections =
            mapping && mapping.notionSections && typeof mapping.notionSections === 'object'
              ? mapping.notionSections
              : {};
          const hasConversationsAnchor = !!(
            mappingSections.conversations && String(mappingSections.conversations.headingBlockId || '').trim()
          );
          if (!hasConversationsAnchor) {
            shouldRebuild = true;
          } else if (!shouldRebuild && !(inc.newMessages && inc.newMessages.length)) {
            let maxUpdatedAt = 0;
            for (const m of Array.isArray(messages) ? messages : []) {
              const at = Number(m && (m.updatedAt as any));
              if (Number.isFinite(at)) maxUpdatedAt = Math.max(maxUpdatedAt, at);
            }

            const cursorInSection =
              mapping &&
              mapping.notionSectionCursors &&
              typeof mapping.notionSectionCursors === 'object' &&
              (mapping.notionSectionCursors as any).conversations &&
              typeof (mapping.notionSectionCursors as any).conversations === 'object'
                ? (mapping.notionSectionCursors as any).conversations
                : null;
            const lastSyncedUpdatedAt = Number(cursorInSection && (cursorInSection.lastSyncedMessageUpdatedAt as any));
            const lastSyncedAt = Number(mapping && (mapping.lastSyncedAt as any));
            // Prefer sync-time baseline to avoid endless rebuilds when earlier messages are edited.
            const baseline = Number.isFinite(lastSyncedAt)
              ? lastSyncedAt
              : Number.isFinite(lastSyncedUpdatedAt)
                ? lastSyncedUpdatedAt
                : 0;
            if (maxUpdatedAt > baseline) shouldRebuild = true;
          }
          if (shouldRebuild) {
            if (!messages.length) {
              throw new Error(`missing cursor for ${toConvoLabel(convo)} and no local messages to rebuild`);
            }

            trace.mark('rebuild page properties');

            await notionSyncService.updatePageProperties(accessToken, {
              pageId,
              properties: pageSpec.buildUpdateProperties(convo),
            });
            trace.mark('build blocks');

            const built = await buildBlocksForSync({
              notionSyncService,
              accessToken: accessToken,
              source: convo.source,
              messagesList: messages,
              conversationId: id,
            });
            const blocks = Array.isArray(built.blocks) ? built.blocks : [];
            if (Array.isArray(built.warnings) && built.warnings.length) warnings.push(...built.warnings);

            trace.mark('rebuild conversations section');
            let rebuilt;
            try {
              const resolved = await ensureSectionHeadingBlockId({
                accessToken: accessToken,
                pageId,
                section: conversationsSection,
                mapping,
                notionSyncService,
                storage,
                conversationId: id,
              });
              rebuilt = await rebuildSectionByArchivingHeading({
                accessToken: accessToken,
                pageId,
                section: conversationsSection,
                currentHeadingBlockId: resolved.headingBlockId,
                desiredBlocks: blocks,
                notionSyncService,
              });
            } catch (e) {
              if (!isStaleBlockAnchorError(e)) throw e;
              trace.mark('recover conversations rebuild');
              rebuilt = await rebuildSectionByArchivingHeading({
                accessToken: accessToken,
                pageId,
                section: conversationsSection,
                currentHeadingBlockId: '',
                desiredBlocks: blocks,
                notionSyncService,
              });
            }

            if (storage && typeof storage.patchSyncMapping === 'function') {
              await storage.patchSyncMapping(id, {
                notionSections: { conversations: { headingBlockId: rebuilt.headingBlockId } },
              });
            }
            const nextCursor = lastMessageCursor(messages);
            trace.mark('save cursor');

            await storage.setSyncCursor(id, {
              ...nextCursor,
              notionSectionCursors: {
                conversations: {
                  lastSyncedMessageKey: nextCursor.lastSyncedMessageKey,
                  lastSyncedSequence: nextCursor.lastSyncedSequence,
                  lastSyncedMessageUpdatedAt: nextCursor.lastSyncedMessageUpdatedAt,
                },
              },
            });
            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: true,
              notionPageId: pageId,
              mode: 'rebuilt',
              appended: 0,
              warnings,
            });
            trace.flush({ mode: 'rebuilt', ok: true, blockCount: blocks.length });
            return;
          } else if (inc.newMessages && inc.newMessages.length) {
            trace.mark('update page properties');

            await notionSyncService.updatePageProperties(accessToken, {
              pageId,
              properties: pageSpec.buildUpdateProperties(convo),
            });
            trace.mark('build blocks');

            const built = await buildBlocksForSync({
              notionSyncService,
              accessToken: accessToken,
              source: convo.source,
              messagesList: inc.newMessages,
              conversationId: id,
            });
            const blocks = Array.isArray(built.blocks) ? built.blocks : [];
            if (Array.isArray(built.warnings) && built.warnings.length) warnings.push(...built.warnings);
            if (blocks.length) {
              trace.mark('append children');
              const layout = layoutSpecForConversationKind(kind.id);
              const conversationsSection =
                (layout.sections || []).find((s) => s && String(s.id) === 'conversations') || layout.sections?.[0];
              if (!conversationsSection) throw new Error('missing conversations section spec');
              const resolved = await ensureSectionHeadingBlockId({
                accessToken: accessToken,
                pageId,
                section: conversationsSection,
                mapping,
                notionSyncService,
                storage,
                conversationId: id,
              });
              try {
                await notionSyncService.appendChildren(accessToken, resolved.headingBlockId, blocks);
              } catch (e) {
                if (!isStaleBlockAnchorError(e)) throw e;
                trace.mark('recover conversations anchor');
                const recoveredId = await recoverSectionHeadingBlockId({
                  accessToken: accessToken,
                  pageId,
                  section: conversationsSection,
                  notionSyncService,
                });
                if (storage && typeof storage.patchSyncMapping === 'function') {
                  await storage.patchSyncMapping(id, {
                    notionSections: { conversations: { headingBlockId: recoveredId } },
                  });
                }

                await notionSyncService.appendChildren(accessToken, recoveredId, blocks);
              }
            }
            const nextCursor = lastMessageCursor(messages);
            trace.mark('save cursor');

            await storage.setSyncCursor(id, {
              ...nextCursor,
              notionSectionCursors: {
                conversations: {
                  lastSyncedMessageKey: nextCursor.lastSyncedMessageKey,
                  lastSyncedSequence: nextCursor.lastSyncedSequence,
                  lastSyncedMessageUpdatedAt: nextCursor.lastSyncedMessageUpdatedAt,
                },
              },
            });
            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: true,
              notionPageId: pageId,
              mode: 'appended',
              appended: inc.newMessages.length,
              warnings,
            });
            trace.flush({ mode: 'appended', ok: true, blockCount: blocks.length });
          } else {
            const desiredProperties = pageSpec.buildUpdateProperties(convo);
            const needsPropertyUpdate = pagePropertiesNeedUpdate(existingPage, desiredProperties);
            if (needsPropertyUpdate) {
              trace.mark('update page properties');

              await notionSyncService.updatePageProperties(accessToken, {
                pageId,
                properties: desiredProperties,
              });
            }
            if (inc && inc.ok) {
              const nextCursor = lastMessageCursor(messages);
              trace.mark('save cursor');

              await storage.setSyncCursor(id, {
                ...nextCursor,
                notionSectionCursors: {
                  conversations: {
                    lastSyncedMessageKey: nextCursor.lastSyncedMessageKey,
                    lastSyncedSequence: nextCursor.lastSyncedSequence,
                    lastSyncedMessageUpdatedAt: nextCursor.lastSyncedMessageUpdatedAt,
                  },
                },
              });
            }
            lifecycle.recordResult({
              conversationId: id,
              conversationTitle,
              ok: true,
              notionPageId: pageId,
              mode: needsPropertyUpdate ? 'updated_properties' : 'no_changes',
              appended: 0,
            });
            trace.flush({ mode: needsPropertyUpdate ? 'updated_properties' : 'no_changes', ok: true, blockCount: 0 });
          }
        } catch (e) {
          const normalizedError = normalizeNotionSyncError(e);
          lifecycle.recordResult({
            conversationId: id,
            conversationTitle,
            ok: false,
            error: normalizedError,
            warnings,
          });
          trace.flush({ mode: 'failed', ok: false, error: normalizedError });
        } finally {
          await lifecycle.finishItem(id);
        }
      }

      const queue = [...ids];
      let cursorIndex = 0;
      const workerCount = Math.max(1, Math.min(SYNC_CONVERSATION_CONCURRENCY, queue.length));
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          for (;;) {
            const next = queue[cursorIndex];
            cursorIndex += 1;
            if (!next) return;
            await processConversation(next);
          }
        }),
      );

      await lifecycle.finish();
      return { ...lifecycle.summary(), jobId };
    } catch (e) {
      await lifecycle.failPending(normalizeNotionSyncError(e));
      throw e;
    }
  }

  function syncConversations(input: any) {
    return ownership.startRun(() => runSyncConversations(input));
  }

  return {
    clearSyncJobStatus,
    getSyncJobStatus,
    syncConversations,
    isRunActive: () => ownership.isRunActive(),
    runExclusiveMaintenance,
    reconcileStartupSyncJob,
  };
}

import { storageGet, storageSet } from '@platform/storage/local';
import { backgroundStorage as defaultBackgroundStorage } from '@services/conversations/background/storage';
import { formatConversationMarkdownForFeishuDocxSync } from '@services/sync/feishu/docx/feishu-docx-markdown';
import { fetchFeishuJson } from '@services/sync/feishu/feishu-api';
import { getFeishuOAuthToken, setFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import feishuSyncJobStore from '@services/sync/feishu/feishu-sync-job-store.ts';
import { getFeishuPathConfig, pickFeishuFolderPathForConversation } from '@services/sync/feishu/settings-store';
import { resolveFeishuDriveFolderTokenByPath } from '@services/sync/feishu/drive-folder-path';
import {
  convertContentToBlocks,
  isFeishuConvertPermissionDenied,
  normalizeConvertedBlocksPreorder,
} from '@services/sync/feishu/docx/convert-api';
import { preprocessFeishuDocxMarkdownImages } from '@services/sync/feishu/docx/feishu-docx-image-preprocess';
import { bindFeishuDocxImagesByOrder } from '@services/sync/feishu/docx/image-block-binder';
import { sha256Hex } from '@services/sync/shared/content-hash';
import { createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';

const SYNC_PROVIDER = 'feishu';
const TOKEN_EXCHANGE_PROXY_URL_KEY = 'feishu_oauth_token_exchange_proxy_url';
const OAUTH_CLIENT_ID_KEY = 'feishu_oauth_client_id';
const OAUTH_CLIENT_SECRET_KEY = 'feishu_oauth_client_secret';
const ROOT_FOLDER_TOKEN_KEY = 'feishu_root_folder_token';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function sanitizeUrlForWarning(url: string): string {
  const raw = safeString(url);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const keys = Array.from(new Set(Array.from(u.searchParams.keys()))).slice(0, 12);
    const q = keys.length ? `?keys=${keys.join(',')}` : '';
    return `${u.origin}${u.pathname}${q}`;
  } catch (_e) {
    return raw.slice(0, 140);
  }
}

function sanitizePotentialUrls(text: string): string {
  const src = safeString(text);
  if (!src) return '';
  return src.replace(/https?:\/\/[^\s)]+/gi, (matched) => sanitizeUrlForWarning(matched));
}

function limitWarnings(warnings: string[], maxCount: number): string[] {
  const list = Array.isArray(warnings) ? warnings.map((w) => safeString(w)).filter(Boolean) : [];
  const max = Number.isFinite(Number(maxCount)) ? Math.max(1, Math.floor(Number(maxCount))) : 20;
  if (list.length <= max) return list;
  const remain = list.length - max;
  return [...list.slice(0, max), `(+${remain} more)`];
}

function normalizeOAuthTokenResponse(
  json: any,
): { access_token: string; refresh_token?: string; expires_in?: number } | null {
  if (!json || typeof json !== 'object') return null;
  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (accessToken) {
    return {
      access_token: accessToken,
      refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expires_in: Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : undefined,
    };
  }

  const data = (json as any).data;
  const nestedAccess = typeof data?.access_token === 'string' ? data.access_token : '';
  if (!nestedAccess) return null;
  return {
    access_token: nestedAccess,
    refresh_token: typeof data?.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: Number.isFinite(Number(data?.expires_in)) ? Number(data.expires_in) : undefined,
  };
}

function normalizeIds(list: unknown) {
  const ids = Array.isArray(list) ? list : [];
  return Array.from(new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
}

function buildAlreadyRunningError() {
  const error = new Error('sync already in progress') as Error & { code?: string };
  error.code = 'sync_already_running';
  return error;
}

async function resolveFeishuAccessToken(): Promise<string> {
  const token = await getFeishuOAuthToken();
  if (!token || !safeString(token.accessToken)) throw new Error('Feishu is not connected');
  const now = Date.now();
  const expiresAt = Number(token.expiresAt) || 0;
  if (!expiresAt || expiresAt - now > 45_000) return safeString(token.accessToken);

  const refreshed = await refreshFeishuOAuthToken(token);
  return safeString(refreshed.accessToken);
}

function deriveRefreshProxyUrl(exchangeProxyUrl: string): string {
  const raw = safeString(exchangeProxyUrl);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.pathname.endsWith('/refresh')) return u.toString();
    if (u.pathname.endsWith('/exchange')) {
      u.pathname = u.pathname.replace(/\/exchange$/i, '/refresh');
      return u.toString();
    }
    u.pathname = `${u.pathname.replace(/\/$/, '')}/refresh`;
    return u.toString();
  } catch (_e) {
    return '';
  }
}

async function refreshFeishuOAuthToken(current: { refreshToken: string; accessToken: string }) {
  const refreshToken = safeString((current as any).refreshToken);
  if (!refreshToken) throw new Error('Feishu refresh token missing');

  const res = await storageGet([TOKEN_EXCHANGE_PROXY_URL_KEY, OAUTH_CLIENT_ID_KEY, OAUTH_CLIENT_SECRET_KEY]).catch(
    () => ({}),
  );
  const clientId = safeString((res as any)?.[OAUTH_CLIENT_ID_KEY]);
  const clientSecret = safeString((res as any)?.[OAUTH_CLIENT_SECRET_KEY]);

  if (clientSecret) {
    if (!clientId) throw new Error('Feishu OAuth client id not configured');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const resp = await fetch(FEISHU_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await resp.text();
    if (!resp.ok) throw new Error(text || `token refresh failed: HTTP ${resp.status}`);
    const rawJson = text ? JSON.parse(text) : null;
    const normalized = normalizeOAuthTokenResponse(rawJson);
    const accessToken = safeString(normalized?.access_token);
    if (!accessToken) throw new Error('token refresh failed: missing access_token');

    const now = Date.now();
    const expiresInSeconds = Number(normalized?.expires_in) || 0;
    const next = {
      ...(await getFeishuOAuthToken()),
      accessToken,
      refreshToken: safeString(normalized?.refresh_token) || refreshToken,
      expiresAt: expiresInSeconds > 0 ? now + expiresInSeconds * 1000 : now,
      createdAt: now,
    };
    await setFeishuOAuthToken(next as any);
    return next as any;
  }

  const exchangeProxyUrl = safeString((res as any)?.[TOKEN_EXCHANGE_PROXY_URL_KEY]);
  const refreshProxyUrl = deriveRefreshProxyUrl(exchangeProxyUrl);
  if (!refreshProxyUrl) throw new Error('Feishu token refresh proxy url not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const resp = await fetch(refreshProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  const text = await resp.text();
  if (!resp.ok) throw new Error(text || `token refresh failed: HTTP ${resp.status}`);
  const rawJson = text ? JSON.parse(text) : null;
  const normalized = normalizeOAuthTokenResponse(rawJson);
  const accessToken = safeString(normalized?.access_token);
  if (!accessToken) throw new Error('token refresh failed: missing access_token');
  const now = Date.now();
  const expiresInSeconds = Number(normalized?.expires_in) || 0;
  const next = {
    ...(await getFeishuOAuthToken()),
    accessToken,
    refreshToken: safeString(normalized?.refresh_token) || refreshToken,
    expiresAt: expiresInSeconds > 0 ? now + expiresInSeconds * 1000 : now,
    createdAt: now,
  };
  await setFeishuOAuthToken(next as any);
  return next as any;
}

async function resolveRootFolderToken(accessToken: string): Promise<string> {
  const cached = await storageGet([ROOT_FOLDER_TOKEN_KEY])
    .then((res) => safeString((res as any)?.[ROOT_FOLDER_TOKEN_KEY]))
    .catch(() => '');
  if (cached) return cached;

  const data = await fetchFeishuJson<any>(
    '/drive/explorer/v2/root_folder/meta',
    { method: 'GET' },
    { accessToken, retry: { attempts: 3 } },
  );
  const token =
    safeString(data?.token) ||
    safeString(data?.folder_token) ||
    safeString(data?.folderToken) ||
    safeString(data?.data?.token) ||
    safeString(data?.data?.folder_token);
  if (token) {
    await storageSet({ [ROOT_FOLDER_TOKEN_KEY]: token }).catch(() => {});
  }
  return token;
}

function toDrivePermissionHintError(error: unknown): Error {
  const e: any = error;
  const status = Number(e?.extra?.status || 0) || 0;
  if (status === 401 || status === 403) {
    return new Error('Feishu Drive permission denied. Please reconnect Feishu with scope "drive:drive".');
  }
  return e instanceof Error ? e : new Error(safeString(e) || 'Feishu Drive error');
}

function isFeishuDocxGoneError(error: unknown): boolean {
  const e: any = error;
  const code = Number(e?.extra?.code || 0) || 0;
  return code === 1770002 || code === 1770003;
}

async function canAccessDocx(accessToken: string, docId: string): Promise<boolean> {
  const token = safeString(docId);
  if (!token) return false;
  try {
    await fetchFeishuJson<any>(`/docx/v1/documents/${encodeURIComponent(token)}`, { method: 'GET' }, { accessToken });
    return true;
  } catch (e) {
    if (isFeishuDocxGoneError(e)) return false;
    throw e;
  }
}

async function resolveConfiguredTargetFolderToken(
  accessToken: string,
  conversation: any,
): Promise<{ folderToken: string; warnings: string[]; hasConfig: boolean }> {
  const config = await getFeishuPathConfig();
  const folderPath = pickFeishuFolderPathForConversation(conversation, config);
  const segments = folderPath
    .split('/')
    .map((s) => safeString(s))
    .filter(Boolean);
  if (!segments.length) return { folderToken: '', warnings: [], hasConfig: false };

  const rootToken = await resolveRootFolderToken(accessToken);
  try {
    const res = await resolveFeishuDriveFolderTokenByPath({
      accessToken,
      rootFolderToken: rootToken,
      pathSegments: segments,
    });
    return { folderToken: res.folderToken, warnings: res.warnings, hasConfig: true };
  } catch (e) {
    throw toDrivePermissionHintError(e);
  }
}

async function createDoc({
  accessToken,
  title,
  folderToken,
}: {
  accessToken: string;
  title: string;
  folderToken?: string;
}): Promise<string> {
  const payloadBase: Record<string, unknown> = { title: safeString(title) || 'Untitled' };
  const explicitFolderToken = safeString(folderToken);
  if (explicitFolderToken) payloadBase.folder_token = explicitFolderToken;

  const create = async (payload: Record<string, unknown>) => {
    const data = await fetchFeishuJson<any>(
      '/docx/v1/documents',
      { method: 'POST', body: JSON.stringify(payload) },
      {
        accessToken,
      },
    );
    const docId =
      safeString(data?.document?.document_id) ||
      safeString(data?.document?.documentId) ||
      safeString(data?.document_id) ||
      safeString(data?.documentId);
    if (!docId) throw new Error('Feishu doc create failed: missing document_id');
    return docId;
  };

  try {
    return await create(payloadBase);
  } catch (error: any) {
    const msg = safeString(error?.message).toLowerCase();
    const mightNeedFolder = msg.includes('folder') || msg.includes('folder_token');
    if (!mightNeedFolder) throw error;
    if (explicitFolderToken) throw error;

    const rootFolderToken = await resolveRootFolderToken(accessToken).catch(() => '');
    if (!rootFolderToken) {
      throw new Error('Feishu doc create failed: missing folder_token (MVP has no folder selector)');
    }
    return create({ ...payloadBase, folder_token: rootFolderToken });
  }
}

async function listRootChildren({ accessToken, docId }: { accessToken: string; docId: string }): Promise<any[]> {
  const data = await fetchFeishuJson<any>(
    `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children?page_size=500`,
    { method: 'GET' },
    { accessToken, retry: { attempts: 3 } },
  );
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.children) ? data.children : [];
  return items;
}

async function clearRootChildren({ accessToken, docId }: { accessToken: string; docId: string }): Promise<void> {
  for (let round = 0; round < 80; round += 1) {
    const items = await listRootChildren({ accessToken, docId }).catch(() => []);
    if (!items.length) return;

    await fetchFeishuJson<any>(
      `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children/batch_delete`,
      { method: 'DELETE', body: JSON.stringify({ start_index: 0, end_index: items.length }) },
      { accessToken },
    );

    // Best-effort throttle: the DocX block APIs are rate-limited.
    await new Promise((r) => setTimeout(r, 350));
  }

  throw new Error('Feishu doc clear failed: too many blocks');
}

function splitMarkdownIntoChunks(markdown: string): string[] {
  const text = String(markdown || '');
  if (!text) return [];
  const maxChunk = 8000;
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = Math.min(text.length, cursor + maxChunk);
    out.push(text.slice(cursor, next));
    cursor = next;
  }
  return out;
}

function sanitizeConvertedBlocksForInsert(blocks: any[]): any[] {
  if (!Array.isArray(blocks) || !blocks.length) return [];

  // The Convert API may include read-only fields for some block types (e.g. table merge_info).
  // Strip known problematic fields best-effort to reduce schema mismatch errors.
  return blocks.map((block) => {
    const next = block && typeof block === 'object' ? JSON.parse(JSON.stringify(block)) : block;
    try {
      if (next?.block_type === 31 && next?.table?.property && typeof next.table.property === 'object') {
        delete next.table.property.merge_info;
      }
    } catch (_e) {
      // ignore
    }
    return next;
  });
}

function readDocxBlockId(block: any): string {
  if (!block || typeof block !== 'object') return '';
  return safeString((block as any).block_id ?? (block as any).blockId ?? (block as any).id);
}

function readDocxBlockChildrenIds(block: any): string[] {
  if (!block || typeof block !== 'object') return [];
  const raw = (block as any).children ?? (block as any).children_id ?? (block as any).childrenIds;
  const list = Array.isArray(raw) ? raw : [];
  return Array.from(new Set(list.map((id: any) => safeString(id)).filter(Boolean)));
}

async function appendConvertedBlocks({
  accessToken,
  docId,
  markdown,
}: {
  accessToken: string;
  docId: string;
  markdown: string;
}): Promise<number> {
  const convertedRaw = await convertContentToBlocks({ accessToken, content: markdown, contentType: 'markdown' });
  const converted = normalizeConvertedBlocksPreorder(convertedRaw);
  const blocks = sanitizeConvertedBlocksForInsert(converted.blocks);
  if (!blocks.length) throw new Error('Feishu Convert API: empty blocks');

  // Prefer descendant insertion when Convert returns first-level block ids (needed for nested structures).
  if (converted.firstLevelBlockIds.length) {
    const MAX_DESCENDANTS = 1000;

    const insertDescendantBatch = async (childrenId: string[], descendants: any[]) => {
      await fetchFeishuJson<any>(
        `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/descendant`,
        {
          method: 'POST',
          body: JSON.stringify({ children_id: childrenId, descendants, index: -1 }),
        },
        { accessToken },
      );
      await new Promise((r) => setTimeout(r, 350));
    };

    if (blocks.length <= MAX_DESCENDANTS) {
      await insertDescendantBatch(converted.firstLevelBlockIds, blocks);
      return converted.firstLevelBlockIds.length;
    }

    // Large docs: best-effort batch descendant insertion by root subtrees.
    const idToChildren = new Map<string, string[]>();
    for (const block of blocks) {
      const id = readDocxBlockId(block);
      if (!id) continue;
      if (!idToChildren.has(id)) idToChildren.set(id, readDocxBlockChildrenIds(block));
    }

    const collectSubtreeIds = (rootId: string): Set<string> => {
      const out = new Set<string>();
      const stack = [safeString(rootId)].filter(Boolean);
      while (stack.length) {
        const id = stack.pop()!;
        if (!id || out.has(id)) continue;
        out.add(id);
        const children = idToChildren.get(id) || [];
        for (const childId of children) {
          if (!out.has(childId)) stack.push(childId);
        }
      }
      return out;
    };

    const insertedIds = new Set<string>();
    const roots = converted.firstLevelBlockIds;

    let batchRoots: string[] = [];
    let batchIds = new Set<string>();

    const flush = async () => {
      if (!batchRoots.length) return;
      const descendants = blocks.filter((b) => batchIds.has(readDocxBlockId(b)));
      if (descendants.length) await insertDescendantBatch(batchRoots, descendants);
      for (const id of batchIds) insertedIds.add(id);
      batchRoots = [];
      batchIds = new Set<string>();
    };

    for (const rootId of roots) {
      const subtree = collectSubtreeIds(rootId);
      if (!subtree.size) continue;

      if (subtree.size > MAX_DESCENDANTS) {
        // Too large even for a single descendant insert: degrade to flat insertion for that subtree.
        await flush();
        const flat = blocks.filter((b) => subtree.has(readDocxBlockId(b)));
        if (flat.length) {
          const batchSize = 20;
          for (let i = 0; i < flat.length; i += batchSize) {
            const slice = flat.slice(i, i + batchSize);
            await fetchFeishuJson<any>(
              `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children`,
              { method: 'POST', body: JSON.stringify({ children: slice, index: -1 }) },
              { accessToken },
            );
            await new Promise((r) => setTimeout(r, 350));
          }
          for (const b of flat) {
            const id = readDocxBlockId(b);
            if (id) insertedIds.add(id);
          }
        }
        continue;
      }

      if (!batchRoots.length) {
        batchRoots = [rootId];
        batchIds = subtree;
        continue;
      }

      if (batchIds.size + subtree.size > MAX_DESCENDANTS) {
        await flush();
        batchRoots = [rootId];
        batchIds = subtree;
        continue;
      }

      batchRoots.push(rootId);
      for (const id of subtree) batchIds.add(id);
    }

    await flush();

    // Best-effort: append any unreachable/orphan blocks via flat insertion (to avoid full text fallback).
    const orphans = blocks.filter((b) => {
      const id = readDocxBlockId(b);
      return id ? !insertedIds.has(id) : true;
    });
    if (orphans.length) {
      const batchSize = 20;
      for (let i = 0; i < orphans.length; i += batchSize) {
        const slice = orphans.slice(i, i + batchSize);
        await fetchFeishuJson<any>(
          `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children`,
          { method: 'POST', body: JSON.stringify({ children: slice, index: -1 }) },
          { accessToken },
        );
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    return roots.length;
  }

  // Fallback to flat children insertion (max 50 blocks per request; keep small to avoid rate-limit).
  const batchSize = 20;
  let appended = 0;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const slice = blocks.slice(i, i + batchSize);
    await fetchFeishuJson<any>(
      `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children`,
      { method: 'POST', body: JSON.stringify({ children: slice, index: -1 }) },
      { accessToken },
    );
    appended += slice.length;
    await new Promise((r) => setTimeout(r, 350));
  }
  return appended;
}

async function appendMarkdownWithConvertFallback({
  accessToken,
  docId,
  markdown,
}: {
  accessToken: string;
  docId: string;
  markdown: string;
}): Promise<{ appended: number; warnings: string[] }> {
  const preprocessed = await preprocessFeishuDocxMarkdownImages(markdown).catch(() => ({
    markdownForConvert: markdown,
    imageSourcesInOrder: [],
  }));

  try {
    const appended = await appendConvertedBlocks({ accessToken, docId, markdown: preprocessed.markdownForConvert });
    const bind = await bindFeishuDocxImagesByOrder({
      accessToken,
      docId,
      imageSourcesInOrder: preprocessed.imageSourcesInOrder,
    }).catch((e) => ({
      imageCount: preprocessed.imageSourcesInOrder.length,
      docImageBlockCount: 0,
      boundCount: 0,
      warnings: [`image bind failed: ${sanitizePotentialUrls(safeString((e as any)?.message || e || ''))}`],
    }));
    return { appended, warnings: bind.warnings || [] };
  } catch (e) {
    if (isFeishuConvertPermissionDenied(e)) {
      return { appended: await appendTextBlocks({ accessToken, docId, markdown }), warnings: [] };
    }
    return { appended: await appendTextBlocks({ accessToken, docId, markdown }), warnings: [] };
  }
}

async function appendTextBlocks({
  accessToken,
  docId,
  markdown,
}: {
  accessToken: string;
  docId: string;
  markdown: string;
}): Promise<number> {
  const chunks = splitMarkdownIntoChunks(markdown);
  if (!chunks.length) return 0;
  const blocks = chunks.map((content) => ({
    block_type: 2,
    text: { elements: [{ text_run: { content } }] },
  }));

  const batchSize = 20;
  let appended = 0;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const slice = blocks.slice(i, i + batchSize);
    await fetchFeishuJson<any>(
      `/docx/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(docId)}/children`,
      { method: 'POST', body: JSON.stringify({ children: slice, index: -1 }) },
      { accessToken },
    );
    appended += slice.length;
    await new Promise((r) => setTimeout(r, 350));
  }
  return appended;
}

async function getSyncStatus({ instanceId }: { instanceId?: string } = {}) {
  const safeInstanceId = safeString(instanceId);
  const job =
    safeInstanceId && typeof feishuSyncJobStore.abortRunningJobIfFromOtherInstance === 'function'
      ? await feishuSyncJobStore.abortRunningJobIfFromOtherInstance(safeInstanceId, { forceAbort: true })
      : await feishuSyncJobStore.getJob();
  return { provider: SYNC_PROVIDER, job, instanceId: safeInstanceId };
}

async function clearSyncStatus({ instanceId }: { instanceId?: string } = {}) {
  await feishuSyncJobStore.setJob(null);
  return { provider: SYNC_PROVIDER, job: null, instanceId: safeString(instanceId) };
}

async function syncConversations({
  conversationIds,
  instanceId,
}: {
  conversationIds?: unknown[];
  instanceId?: string;
} = {}) {
  const ids = normalizeIds(conversationIds);
  if (!ids.length) {
    return {
      provider: SYNC_PROVIDER,
      okCount: 0,
      failCount: 0,
      failures: [],
      results: [],
      instanceId: safeString(instanceId),
    };
  }

  const safeInstanceId = safeString(instanceId);
  const existingJob = await feishuSyncJobStore.abortRunningJobIfFromOtherInstance(safeInstanceId);
  if (feishuSyncJobStore.isRunningJob(existingJob)) throw buildAlreadyRunningError();

  const startedAt = Date.now();
  const lifecycle = createSyncJobLifecycle({
    initialJob: {
      id: `${startedAt}_${Math.random().toString(16).slice(2)}`,
      provider: SYNC_PROVIDER,
      instanceId: safeInstanceId,
      status: 'running',
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      conversationIds: ids,
      currentStage: 'preparing_queue',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    },
    persist: (job) => feishuSyncJobStore.setJob(job),
  });

  await lifecycle.setRunStage('preparing_queue');
  let accessToken = '';

  for (const conversationId of ids) {
    let row: any = null;
    try {
      await lifecycle.setRunStage('loading_conversation');

      const mappingRes = await defaultBackgroundStorage.getSyncMappingByConversation(conversationId);
      if (!mappingRes || !mappingRes.conversation) {
        row = {
          conversationId,
          conversationTitle: '',
          ok: false,
          mode: 'failed',
          appended: 0,
          error: 'conversation not found',
          at: Date.now(),
        };
      } else {
        const convo: any = mappingRes.conversation;
        const conversationTitle = safeString(convo.title);
        const documentTitle = conversationTitle || `conversation#${conversationId}`;
        await lifecycle.setItem(conversationId, { conversationTitle, currentStage: 'preparing_sync' });

        accessToken = accessToken || (await resolveFeishuAccessToken());
        const messages = await defaultBackgroundStorage.getMessagesByConversationId(conversationId);
        const detail = { id: conversationId, messages: Array.isArray(messages) ? messages : [] } as any;

        const markdown = await formatConversationMarkdownForFeishuDocxSync(convo as any, detail as any);
        const existingDocId = safeString(mappingRes.mapping?.feishuDocId);
        const existingContentHash = safeString(mappingRes.mapping?.feishuLastContentHash);
        const contentHash = await sha256Hex(markdown).catch(() => '');
        let docId = existingDocId;
        let mode = existingDocId ? 'overwrite' : 'create';
        let createWarnings: string[] = [];

        if (existingDocId && existingContentHash && contentHash && existingContentHash === contentHash) {
          // If the destination doc was deleted/moved to recycle bin, "skipped_unchanged" would make the user
          // think the sync worked while the doc is still missing. We first verify the doc exists; otherwise
          // we fall back to creating a new destination doc.
          let canSkip = true;
          try {
            canSkip = await canAccessDocx(accessToken, existingDocId);
          } catch (_e) {
            // If we can't verify status due to transient errors, fall back to normal overwrite flow.
            canSkip = false;
          }

          if (!canSkip) {
            docId = '';
            mode = 'create';
          } else {
            const syncedAt = Date.now();
            await defaultBackgroundStorage.patchSyncMapping(conversationId, {
              feishuDocId: existingDocId,
              feishuLastContentHash: contentHash,
              feishuLastSyncedAt: syncedAt,
            });

            row = {
              conversationId,
              conversationTitle,
              ok: true,
              mode: 'skipped_unchanged',
              appended: 0,
              error: '',
              warnings: [],
              at: syncedAt,
            };
            row = (await lifecycle.completeItem(row)).row;
            continue;
          }
        }

        if (docId) {
          await lifecycle.setItem(conversationId, { currentStage: 'rebuilding_destination_page' });
          try {
            await clearRootChildren({ accessToken, docId });
          } catch (_e) {
            docId = '';
            mode = 'create';
          }
        }

        if (!docId) {
          await lifecycle.setItem(conversationId, { currentStage: 'creating_destination_page' });
          let folderToken: string | undefined = undefined;
          const resolved = await resolveConfiguredTargetFolderToken(accessToken, convo);
          if (resolved.hasConfig) {
            if (!resolved.folderToken) {
              throw new Error('Feishu folder resolve failed: empty folder_token');
            }
            folderToken = resolved.folderToken;
            createWarnings = resolved.warnings;
          }

          docId = await createDoc({ accessToken, title: documentTitle, folderToken });
        }

        await lifecycle.setItem(conversationId, { currentStage: 'uploading_message_blocks' });
        let appended = 0;
        let appendWarnings: string[] = [];
        try {
          const res = await appendMarkdownWithConvertFallback({ accessToken, docId, markdown });
          appended = res.appended;
          appendWarnings = Array.isArray(res.warnings) ? res.warnings : [];
        } catch (e) {
          if (existingDocId) {
            mode = 'create';
            await lifecycle.setItem(conversationId, { currentStage: 'creating_destination_page' });
            docId = await createDoc({ accessToken, title: documentTitle });
            await lifecycle.setItem(conversationId, { currentStage: 'uploading_message_blocks' });
            const res = await appendMarkdownWithConvertFallback({ accessToken, docId, markdown });
            appended = res.appended;
            appendWarnings = Array.isArray(res.warnings) ? res.warnings : [];
          } else {
            throw e;
          }
        }

        const syncedAt = Date.now();
        await defaultBackgroundStorage.patchSyncMapping(conversationId, {
          feishuDocId: docId,
          feishuLastContentHash: contentHash,
          feishuLastSyncedAt: syncedAt,
        });

        row = {
          conversationId,
          conversationTitle,
          ok: true,
          mode,
          appended,
          error: '',
          warnings: limitWarnings([...createWarnings, ...appendWarnings], 20),
          at: syncedAt,
        };
      }
    } catch (e: any) {
      row = {
        conversationId,
        conversationTitle: lifecycle.titleFor(conversationId),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: e && e.message ? e.message : String(e || 'sync failed'),
        at: Date.now(),
      };
    }

    row = (await lifecycle.completeItem(row)).row;
  }

  await lifecycle.finish();
  return lifecycle.summary();
}

const api = { getSyncStatus, clearSyncStatus, syncConversations };

export { getSyncStatus, clearSyncStatus, syncConversations };
export default api;

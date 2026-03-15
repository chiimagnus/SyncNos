import { backgroundStorage as defaultBackgroundStorage } from '../../conversations/background/storage';
import {
  getObsidianConnectionConfig,
  getObsidianPathConfig,
} from './settings-store';
import {
  NOTE_JSON_ACCEPT,
  createClient as createDefaultObsidianClient,
} from './obsidian-local-rest-client.ts';
import {
  appendUnderMessagesHeading as appendDefaultUnderMessagesHeading,
  buildFullNoteMarkdown as buildDefaultFullNoteMarkdown,
  buildIncrementalAppendMarkdown as buildDefaultIncrementalAppendMarkdown,
  replaceSyncnosFrontmatter as replaceDefaultSyncnosFrontmatter,
} from './obsidian-markdown-writer.ts';
import {
  buildStableNotePath as buildDefaultStableNotePath,
  buildLegacyHashNotePath as buildDefaultLegacyHashNotePath,
  resolveExistingNotePath as resolveDefaultExistingNotePath,
  stableConversationId10 as stableConversationId10Default,
} from './obsidian-note-path.ts';
import {
  buildSyncnosObject as buildDefaultSyncnosObject,
  readSyncnosObject as readDefaultSyncnosObject,
} from './obsidian-sync-metadata.ts';
import obsidianSyncJobStore from './obsidian-sync-job-store.ts';
import { getImageCacheAssetById } from '../../conversations/data/image-cache-read';

const SYNC_PROVIDER = 'obsidian';
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function stripAngleBrackets(url: unknown) {
  const text = safeString(url);
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

function parseSyncnosAssetId(url: unknown) {
  const text = safeString(url);
  const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(text);
  if (!matched) return 0;
  const id = Number(matched[1]);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function normalizeImageExt(raw: unknown) {
  const text = safeString(raw).toLowerCase();
  if (!text) return 'png';
  if (text === 'jpeg') return 'jpg';
  if (text === 'svg+xml') return 'svg';
  if (text === 'x-icon' || text === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(text) ? text : 'png';
}

function inferImageExtFromAsset(asset: { contentType?: unknown; url?: unknown }) {
  const contentType = safeString(asset.contentType).toLowerCase();
  if (contentType.startsWith('image/')) return normalizeImageExt(contentType.slice('image/'.length));
  const url = safeString(asset.url);
  if (/^data:image\//i.test(url)) {
    const matched = /^data:image\/([a-z0-9.+-]+)/i.exec(url);
    return normalizeImageExt(matched?.[1] || '');
  }
  try {
    const parsed = new URL(url);
    const pathname = safeString(parsed.pathname);
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) return normalizeImageExt(filename.slice(dot + 1));
  } catch (_e) {
    // ignore
  }
  return 'png';
}

function collectOrderedSyncnosAssetIds(markdown: unknown): number[] {
  const text = String(markdown || '');
  if (!text) return [];
  const seen = new Set<number>();
  const ordered: number[] = [];
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = MARKDOWN_IMAGE_RE.exec(text)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const assetId = parseSyncnosAssetId(stripAngleBrackets(urlPart));
    if (!assetId) continue;
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    ordered.push(assetId);
  }
  return ordered;
}

function replaceSyncnosAssetsWithAttachmentNames(
  markdown: unknown,
  attachmentNameByAssetId: Map<number, string>,
) {
  const text = String(markdown || '');
  if (!text || !attachmentNameByAssetId.size) return text;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  return text.replace(MARKDOWN_IMAGE_RE, (_full, altRaw, urlPartRaw, titleRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const title = titleRaw ? String(titleRaw) : '';
    const assetId = parseSyncnosAssetId(stripAngleBrackets(urlPart));
    if (!assetId) return _full;
    const attachmentName = attachmentNameByAssetId.get(assetId);
    if (!attachmentName) return _full;
    const nextPart = urlPart.trim().startsWith('<') ? `<${attachmentName}>` : attachmentName;
    return `![${alt}](${nextPart}${title})`;
  });
}

function buildNoteBasenameFromFilePath(filePath: unknown) {
  const text = safeString(filePath);
  if (!text) return 'note';
  const filename = text.split('/').filter(Boolean).pop() || text;
  if (filename.toLowerCase().endsWith('.md')) return filename.slice(0, -3) || 'note';
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function buildAttachmentPath(filePath: unknown, attachmentName: string) {
  const raw = safeString(filePath);
  const dir = raw.split('/').slice(0, -1).filter(Boolean).join('/');
  return dir ? `${dir}/${attachmentName}` : attachmentName;
}

async function materializeMarkdownAssetsForObsidian({
  client,
  filePath,
  markdown,
  indexScopeMarkdown,
}: {
  client: any;
  filePath: string;
  markdown: string;
  indexScopeMarkdown?: string;
}): Promise<string> {
  const targetMarkdown = String(markdown || '');
  if (!targetMarkdown) return targetMarkdown;
  if (!client || typeof client.putVaultBinaryFile !== 'function') {
    throw new Error('obsidian client does not support binary attachment upload');
  }

  const scopeIds = collectOrderedSyncnosAssetIds(indexScopeMarkdown || targetMarkdown);
  if (!scopeIds.length) return targetMarkdown;

  const indexByAssetId = new Map<number, number>();
  for (let i = 0; i < scopeIds.length; i += 1) {
    indexByAssetId.set(scopeIds[i]!, i + 1);
  }

  const targetIds = collectOrderedSyncnosAssetIds(targetMarkdown);
  if (!targetIds.length) return targetMarkdown;

  const noteBase = buildNoteBasenameFromFilePath(filePath);
  const attachmentNameByAssetId = new Map<number, string>();

  for (const assetId of targetIds) {
    const index = indexByAssetId.get(assetId);
    if (!index) continue;
    // eslint-disable-next-line no-await-in-loop
    const asset = await getImageCacheAssetById({ id: assetId });
    if (!asset || !(asset.blob instanceof Blob)) continue;

    const ext = inferImageExtFromAsset(asset);
    const attachmentName = `${noteBase}-${index}.${ext}`;
    attachmentNameByAssetId.set(assetId, attachmentName);

    const contentType = safeString(asset.contentType || asset.blob.type) || `image/${ext}`;
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    // eslint-disable-next-line no-await-in-loop
    const putRes = await client.putVaultBinaryFile(
      buildAttachmentPath(filePath, attachmentName),
      bytes,
      { contentType },
    );
    if (!putRes || !putRes.ok) {
      const message = putRes && putRes.error && putRes.error.message ? putRes.error.message : 'attachment put failed';
      throw new Error(String(message || 'attachment put failed'));
    }
  }

  return replaceSyncnosAssetsWithAttachmentNames(targetMarkdown, attachmentNameByAssetId);
}

function normalizeIds(list: unknown) {
  const ids = Array.isArray(list) ? list : [];
  return Array.from(
    new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)),
  );
}

function buildPerConversationResult({
  conversationId,
  conversationTitle,
  ok,
  mode,
  appended,
  error,
  at,
}: {
  conversationId: number;
  conversationTitle?: unknown;
  ok: unknown;
  mode: unknown;
  appended: unknown;
  error: unknown;
  at: unknown;
}) {
  return {
    conversationId,
    conversationTitle: safeString(conversationTitle),
    ok: !!ok,
    mode: safeString(mode) || (ok ? 'ok' : 'failed'),
    appended: Number.isFinite(Number(appended)) ? Number(appended) : 0,
    error: safeString(error),
    at: Number.isFinite(Number(at)) ? Number(at) : Date.now(),
  };
}

function buildSyncSummary(results: any[], instanceId: unknown) {
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({
      conversationId: r.conversationId,
      conversationTitle: safeString(r.conversationTitle),
      error: r.error || 'unknown error',
    }));
  return { provider: SYNC_PROVIDER, okCount, failCount, failures, results, instanceId: safeString(instanceId) };
}

function buildAlreadyRunningError() {
  const error = new Error('sync already in progress') as Error & { code?: string };
  error.code = 'sync_already_running';
  return error;
}

function toCurrentConversationTitle(convo: any, conversationId: number) {
  const title = safeString(convo && convo.title);
  if (title) return title;
  return '';
}

function pickLocalCursor(messages: any[]) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return { lastSyncedSequence: null, lastSyncedMessageKey: '' };
  const last = list[list.length - 1] || {};
  return {
    lastSyncedSequence: Number.isFinite(Number(last.sequence)) ? Number(last.sequence) : null,
    lastSyncedMessageKey: safeString(last.messageKey),
    lastSyncedMessageUpdatedAt: Number.isFinite(Number(last.updatedAt))
      ? Number(last.updatedAt)
      : null,
    lastSyncedAt: Date.now(),
  };
}

function computeDelta(messages: any[], cursor: any) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return { ok: true, newMessages: [], reason: 'empty' };

  const seq =
    cursor &&
    cursor.lastSyncedSequence != null &&
    Number.isFinite(Number(cursor.lastSyncedSequence))
      ? Number(cursor.lastSyncedSequence)
      : null;
  const key = cursor && cursor.lastSyncedMessageKey ? safeString(cursor.lastSyncedMessageKey) : '';
  if (seq == null || !key) return { ok: false, reason: 'missing_cursor' };

  const anchor = list.find(
    (m) => safeString(m && m.messageKey) === key && Number(m && m.sequence) === seq,
  );
  if (!anchor) return { ok: false, reason: 'cursor_mismatch' };

  const expectedUpdatedAt =
    cursor &&
    cursor.lastSyncedMessageUpdatedAt != null &&
    Number.isFinite(Number(cursor.lastSyncedMessageUpdatedAt))
      ? Number(cursor.lastSyncedMessageUpdatedAt)
      : null;
  const actualUpdatedAt =
    anchor && Number.isFinite(Number(anchor.updatedAt)) ? Number(anchor.updatedAt) : null;
  if (expectedUpdatedAt != null && actualUpdatedAt != null && expectedUpdatedAt !== actualUpdatedAt) {
    return { ok: false, reason: 'cursor_updatedAt_mismatch' };
  }

  const newMessages = list.filter((m) => Number(m && m.sequence) > seq);
  return { ok: true, newMessages, reason: newMessages.length ? 'has_changes' : 'no_changes' };
}

function getBackgroundStorageModule() {
  return defaultBackgroundStorage;
}

function getSettingsStoreModule() {
  return {
    getConnectionConfig: getObsidianConnectionConfig,
    getPathConfig: getObsidianPathConfig,
  };
}

function getLocalRestClientModule() {
  return {
    createClient: createDefaultObsidianClient,
    NOTE_JSON_ACCEPT,
  };
}

function getNotePathModule() {
  return {
    buildStableNotePath: buildDefaultStableNotePath,
    buildLegacyHashNotePath: buildDefaultLegacyHashNotePath,
    resolveExistingNotePath: resolveDefaultExistingNotePath,
    stableConversationId10: stableConversationId10Default,
  };
}

function getSyncMetadataModule() {
  return {
    readSyncnosObject: readDefaultSyncnosObject,
    buildSyncnosObject: buildDefaultSyncnosObject,
  };
}

function getMarkdownWriterModule() {
  return {
    buildFullNoteMarkdown: buildDefaultFullNoteMarkdown,
    buildIncrementalAppendMarkdown: buildDefaultIncrementalAppendMarkdown,
    appendUnderMessagesHeading: appendDefaultUnderMessagesHeading,
    replaceSyncnosFrontmatter: replaceDefaultSyncnosFrontmatter,
  };
}

async function buildClient() {
  const store = getSettingsStoreModule();
  const conn = await store.getConnectionConfig();
  if (!conn || !conn.apiKey) {
    return { ok: false, error: { code: 'missing_api_key', message: 'Obsidian API Key is required.' } };
  }

  const clientMod = getLocalRestClientModule();
  const client = clientMod.createClient(conn);
  if (!client || client.ok === false) {
    return {
      ok: false,
      error:
        client && client.error ? client.error : { code: 'invalid_client', message: 'invalid client' },
    };
  }
  return {
    ok: true,
    client,
    noteJsonAccept: safeString(clientMod.NOTE_JSON_ACCEPT) || NOTE_JSON_ACCEPT,
  };
}

async function decideSyncModeForConversation({
  conversationId,
  forceFull,
}: {
  conversationId: number;
  forceFull?: boolean;
}) {
  const storage = getBackgroundStorageModule();
  if (
    !storage ||
    typeof storage.getConversationById !== 'function' ||
    typeof storage.getMessagesByConversationId !== 'function'
  ) {
    throw new Error('storage module missing');
  }

  const convo = await storage.getConversationById(conversationId);
  if (!convo) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo, conversationId),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: 'conversation not found',
        at: Date.now(),
      }),
    };
  }

  const messages = await storage.getMessagesByConversationId(conversationId);
  if (!Array.isArray(messages) || !messages.length) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo, conversationId),
        ok: false,
        mode: 'empty',
        appended: 0,
        error: 'No messages to sync.',
        at: Date.now(),
      }),
    };
  }

  const notePathMod = getNotePathModule();
  const store = getSettingsStoreModule();
  const pathConfig = store && typeof store.getPathConfig === 'function' ? await store.getPathConfig() : null;
  const folderByKindId = pathConfig
    ? { chat: safeString(pathConfig.chatFolder), article: safeString(pathConfig.articleFolder) }
    : undefined;

  const clientRes: any = await buildClient();
  if (!clientRes.ok) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo, conversationId),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: clientRes.error && clientRes.error.message ? clientRes.error.message : 'client error',
        at: Date.now(),
      }),
    };
  }
  const client = clientRes.client;
  const accept = clientRes.noteJsonAccept || client.NOTE_JSON_ACCEPT || NOTE_JSON_ACCEPT;

  const metaMod = getSyncMetadataModule();

  let existingRemote: any = null;
  let existingPath = '';
  let deleteAfterFilePath = '';

  const pathResolution =
    notePathMod && typeof (notePathMod as any).resolveExistingNotePath === 'function'
      ? await (notePathMod as any).resolveExistingNotePath({
          conversation: convo,
          client,
          noteJsonAccept: accept,
          folderByKindId,
          readSyncnosObject: metaMod.readSyncnosObject,
        })
      : null;

  if (pathResolution && !pathResolution.ok) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo, conversationId),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: pathResolution.error?.message ? String(pathResolution.error.message) : 'remote error',
        at: Date.now(),
      }),
    };
  }

  const desiredFilePath = safeString(pathResolution?.desiredFilePath) || notePathMod.buildStableNotePath(convo, { folderByKindId });
  existingPath = safeString(pathResolution?.resolvedFilePath);

  if (pathResolution?.found && existingPath) {
    existingRemote = {
      ok: true,
      data: pathResolution.note || null,
    };
  }

  if (!existingRemote) {
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath: desiredFilePath,
      messages,
      mode: forceFull ? 'full_rebuild_forced' : 'full_rebuild',
    };
  }

  if (existingPath && existingPath !== desiredFilePath) {
    deleteAfterFilePath = existingPath;
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath: desiredFilePath,
      deleteAfterFilePath,
      messages,
      mode: forceFull ? 'full_rebuild_forced' : 'full_rebuild_rename',
    };
  }

  if (forceFull) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild_forced' };
  }

  const note = existingRemote.data && typeof existingRemote.data === 'object' ? existingRemote.data : null;
  const frontmatter = note && note.frontmatter && typeof note.frontmatter === 'object' ? note.frontmatter : null;

  const parsed = metaMod.readSyncnosObject(frontmatter);
  const parsedData = parsed && parsed.ok && parsed.data ? parsed.data : null;
  if (!parsedData) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }
  if (
    safeString(parsedData.source) !== safeString(convo.source) ||
    safeString(parsedData.conversationKey) !== safeString(convo.conversationKey)
  ) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }

  const delta = computeDelta(messages, parsedData);
  if (!delta.ok) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }
  const newMessages = Array.isArray(delta.newMessages) ? delta.newMessages : [];
  if (!newMessages.length) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo, conversationId),
        ok: true,
        mode: 'no_changes',
        appended: 0,
        error: '',
        at: Date.now(),
      }),
    };
  }

  const nextCursor = pickLocalCursor(messages);
  return {
    isFinal: false,
    conversationId,
    convo,
    filePath: desiredFilePath,
    messages,
    mode: 'incremental_append',
    newMessages,
    nextCursor,
  };
}

async function testConnection({ instanceId }: { instanceId?: string } = {}) {
  const store = getSettingsStoreModule();
  const conn = await store.getConnectionConfig();
  if (!conn || !conn.apiKey) {
    return {
      ok: false,
      error: { code: 'missing_api_key', message: 'Obsidian API Key is required.' },
      message: 'missing api key',
      instanceId: safeString(instanceId),
    };
  }

  const clientMod = getLocalRestClientModule();
  const client = clientMod.createClient(conn);
  if (!client || client.ok === false || typeof (client as any).getServerStatus !== 'function') {
    const error = client && client.error ? client.error : { code: 'invalid_client', message: 'invalid client' };
    return {
      ok: false,
      error,
      message: safeString(error.message) || 'invalid client',
      instanceId: safeString(instanceId),
    };
  }

  const res = await (client as any).getServerStatus();
  if (!res || !res.ok) {
    const error = res && res.error ? res.error : { code: 'network_error', message: 'connection failed' };
    return {
      ok: false,
      error,
      message: safeString(error.message) || 'connection failed',
      instanceId: safeString(instanceId),
    };
  }

  const data = res.data || null;
  const authenticated =
    data && typeof data === 'object' && (data as any).authenticated != null
      ? Boolean((data as any).authenticated)
      : null;
  if (authenticated === false) {
    const message = safeString((data as any)?.message) || 'unauthorized';
    return {
      ok: false,
      error: { code: 'auth_error', message },
      message,
      data,
      instanceId: safeString(instanceId),
    };
  }

  const okMessage = authenticated === true ? 'authenticated' : 'connected';
  return { ok: true, data, message: okMessage, instanceId: safeString(instanceId) };
}

async function getSyncStatus({ instanceId }: { instanceId?: string } = {}) {
  return { provider: SYNC_PROVIDER, job: await obsidianSyncJobStore.getJob(), instanceId: safeString(instanceId) };
}

async function clearSyncStatus({ instanceId }: { instanceId?: string } = {}) {
  await obsidianSyncJobStore.setJob(null);
  return { provider: SYNC_PROVIDER, job: null, instanceId: safeString(instanceId) };
}

async function syncConversations({
  conversationIds,
  forceFullConversationIds,
  instanceId,
}: {
  conversationIds?: unknown[];
  forceFullConversationIds?: unknown[];
  instanceId?: string;
} = {}) {
  const ids = normalizeIds(conversationIds);
  const forceFullIds = new Set(normalizeIds(forceFullConversationIds));
  if (!ids.length) {
    return { provider: SYNC_PROVIDER, okCount: 0, failCount: 0, failures: [], results: [], instanceId: safeString(instanceId) };
  }

  const safeInstanceId = safeString(instanceId);
  const existingJob = await obsidianSyncJobStore.abortRunningJobIfFromOtherInstance(safeInstanceId);
  if (obsidianSyncJobStore.isRunningJob(existingJob)) throw buildAlreadyRunningError();

  const currentJob: any = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    provider: SYNC_PROVIDER,
    instanceId: safeInstanceId,
    status: 'running',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    conversationIds: ids,
    okCount: 0,
    failCount: 0,
    perConversation: [],
  };
  async function persistCurrentJob(partial: Record<string, unknown> = {}) {
    Object.assign(currentJob, partial, { updatedAt: Date.now() });
    await obsidianSyncJobStore.setJob({ ...currentJob });
  }

  await persistCurrentJob({
    currentConversationId: ids[0] || undefined,
    currentStage: ids.length ? 'preparing_queue' : '',
  });

  const results: any[] = [];

  for (const conversationId of ids) {
    let row: any = null;
    try {
      await persistCurrentJob({
        currentConversationId: conversationId,
        currentConversationTitle: '',
        currentStage: 'loading_conversation',
      });
      const decision: any = await decideSyncModeForConversation({
        conversationId,
        forceFull: forceFullIds.has(conversationId),
      });
      if (decision && decision.isFinal) {
        await persistCurrentJob({
          currentConversationId: conversationId,
          currentConversationTitle: toCurrentConversationTitle((decision as any).convo, conversationId),
          currentStage: 'finishing_current_item',
        });
        row = decision.row;
      } else if (decision && decision.mode && decision.conversationId) {
        const writer = getMarkdownWriterModule();
        const metaMod = getSyncMetadataModule();
        const clientRes: any = await buildClient();
        const client = clientRes.ok ? clientRes.client : null;
        const currentTitle = toCurrentConversationTitle(decision.convo, conversationId);

        if (!clientRes.ok || !client) {
          row = buildPerConversationResult({
            conversationId,
            conversationTitle: currentTitle,
            ok: false,
            mode: 'failed',
            appended: 0,
            error: clientRes.error && clientRes.error.message ? clientRes.error.message : 'client error',
            at: Date.now(),
          });
        } else if (
          decision.mode === 'full_rebuild' ||
          decision.mode === 'full_rebuild_forced' ||
          decision.mode === 'full_rebuild_rename'
        ) {
          await persistCurrentJob({
            currentConversationId: conversationId,
            currentConversationTitle: currentTitle,
            currentStage: decision.mode === 'full_rebuild_rename' ? 'renaming_note' : 'writing_full_note',
          });
          const syncnosObject = metaMod.buildSyncnosObject({
            conversation: decision.convo,
            cursor: pickLocalCursor(decision.messages),
          });
          const rawMarkdown = writer.buildFullNoteMarkdown({
            conversation: decision.convo,
            messages: decision.messages,
            syncnosObject,
          });
          const markdown = await materializeMarkdownAssetsForObsidian({
            client,
            filePath: decision.filePath,
            markdown: rawMarkdown,
            indexScopeMarkdown: rawMarkdown,
          });
          const putRes = await client.putVaultFile(decision.filePath, markdown);
          if (!putRes || !putRes.ok) {
            row = buildPerConversationResult({
              conversationId,
              conversationTitle: currentTitle,
              ok: false,
              mode: 'failed',
              appended: 0,
              error: putRes && putRes.error && putRes.error.message ? putRes.error.message : 'put failed',
              at: Date.now(),
            });
          } else {
            const deleteAfter = decision.deleteAfterFilePath ? safeString(decision.deleteAfterFilePath) : '';
            if (deleteAfter && deleteAfter !== safeString(decision.filePath) && typeof client.deleteVaultFile === 'function') {
              await persistCurrentJob({
                currentConversationId: conversationId,
                currentConversationTitle: currentTitle,
                currentStage: 'deleting_old_note_path',
              });
              const delRes = await client.deleteVaultFile(deleteAfter);
              if (!delRes || !delRes.ok) {
                row = buildPerConversationResult({
                  conversationId,
                  conversationTitle: currentTitle,
                  ok: false,
                  mode: 'rename_delete_failed',
                  appended: decision.messages.length,
                  error: delRes && delRes.error && delRes.error.message ? delRes.error.message : 'delete failed',
                  at: Date.now(),
                });
              } else {
                row = buildPerConversationResult({
                  conversationId,
                  conversationTitle: currentTitle,
                  ok: true,
                  mode: decision.mode,
                  appended: decision.messages.length,
                  error: '',
                  at: Date.now(),
                });
              }
            } else {
              row = buildPerConversationResult({
                conversationId,
                conversationTitle: currentTitle,
                ok: true,
                mode: decision.mode,
                appended: decision.messages.length,
                error: '',
                at: Date.now(),
              });
            }
          }
        } else if (decision.mode === 'incremental_append') {
          await persistCurrentJob({
            currentConversationId: conversationId,
            currentConversationTitle: currentTitle,
            currentStage: 'appending_new_messages',
          });
          const chunkRaw = writer.buildIncrementalAppendMarkdown({ newMessages: decision.newMessages });
          const scopeSyncnosObject = metaMod.buildSyncnosObject({
            conversation: decision.convo,
            cursor: pickLocalCursor(decision.messages),
          });
          const scopeMarkdown = writer.buildFullNoteMarkdown({
            conversation: decision.convo,
            messages: decision.messages,
            syncnosObject: scopeSyncnosObject,
          });
          const chunk = await materializeMarkdownAssetsForObsidian({
            client,
            filePath: decision.filePath,
            markdown: chunkRaw,
            indexScopeMarkdown: scopeMarkdown,
          });
          const patchRes = await writer.appendUnderMessagesHeading({
            client,
            filePath: decision.filePath,
            markdown: chunk,
          });
          const isIdempotentDup =
            !patchRes.ok &&
            patchRes.error &&
            patchRes.error.code === 'bad_request' &&
            patchRes.error.body &&
            typeof patchRes.error.body === 'object' &&
            String(patchRes.error.body.message || '').includes('content-already-preexists-in-target');
          const patchFailedCode =
            patchRes && patchRes.error && patchRes.error.body && typeof patchRes.error.body === 'object'
              ? Number(patchRes.error.body.errorCode)
              : null;
          const isPatchFailed =
            !patchRes.ok &&
            (patchFailedCode === 40080 ||
              String(
                (patchRes.error && patchRes.error.body && patchRes.error.body.message) || '',
              ).includes('PatchFailed'));

          if (!patchRes.ok && !isIdempotentDup && !isPatchFailed) {
            row = buildPerConversationResult({
              conversationId,
              conversationTitle: currentTitle,
              ok: false,
              mode: 'failed',
              appended: 0,
              error: patchRes.error && patchRes.error.message ? patchRes.error.message : 'patch failed',
              at: Date.now(),
            });
          } else if (!patchRes.ok && isPatchFailed && !isIdempotentDup) {
            await persistCurrentJob({
              currentConversationId: conversationId,
              currentConversationTitle: currentTitle,
              currentStage: 'falling_back_to_full_rebuild',
            });
            const syncnosObject = metaMod.buildSyncnosObject({
              conversation: decision.convo,
              cursor: pickLocalCursor(decision.messages),
            });
            const rawMarkdown = writer.buildFullNoteMarkdown({
              conversation: decision.convo,
              messages: decision.messages,
              syncnosObject,
            });
            const markdown = await materializeMarkdownAssetsForObsidian({
              client,
              filePath: decision.filePath,
              markdown: rawMarkdown,
              indexScopeMarkdown: rawMarkdown,
            });
            const putRes = await client.putVaultFile(decision.filePath, markdown);
            if (!putRes || !putRes.ok) {
              row = buildPerConversationResult({
                conversationId,
                conversationTitle: currentTitle,
                ok: false,
                mode: 'failed',
                appended: 0,
                error: putRes && putRes.error && putRes.error.message ? putRes.error.message : 'put failed',
                at: Date.now(),
              });
            } else {
              row = buildPerConversationResult({
                conversationId,
                conversationTitle: currentTitle,
                ok: true,
                mode: 'full_rebuild_fallback',
                appended: decision.messages.length,
                error: '',
                at: Date.now(),
              });
            }
          } else {
            await persistCurrentJob({
              currentConversationId: conversationId,
              currentConversationTitle: currentTitle,
              currentStage: 'updating_sync_metadata',
            });
            const syncnosObject = metaMod.buildSyncnosObject({
              conversation: decision.convo,
              cursor: decision.nextCursor,
            });
            const fmRes = await writer.replaceSyncnosFrontmatter({
              client,
              filePath: decision.filePath,
              syncnosObject,
            });
            if (!fmRes || !fmRes.ok) {
              row = buildPerConversationResult({
                conversationId,
                conversationTitle: currentTitle,
                ok: false,
                mode: 'failed',
                appended: 0,
                error: fmRes && fmRes.error && fmRes.error.message
                  ? fmRes.error.message
                  : 'frontmatter patch failed',
                at: Date.now(),
              });
            } else {
              row = buildPerConversationResult({
                conversationId,
                conversationTitle: currentTitle,
                ok: true,
                mode: 'incremental_append',
                appended: decision.newMessages.length,
                error: '',
                at: Date.now(),
              });
            }
          }
        } else {
          row = buildPerConversationResult({
            conversationId,
            conversationTitle: currentTitle,
            ok: false,
            mode: 'failed',
            appended: 0,
            error: 'unknown mode',
            at: Date.now(),
          });
        }
      } else if (decision && decision.row) {
        row = decision.row;
      } else {
        row = buildPerConversationResult({
          conversationId,
          conversationTitle: '',
          ok: false,
          mode: 'failed',
          appended: 0,
          error: 'invalid decision',
          at: Date.now(),
        });
      }
    } catch (e: any) {
      row = buildPerConversationResult({
        conversationId,
        conversationTitle: '',
        ok: false,
        mode: 'failed',
        appended: 0,
        error: e && e.message ? e.message : String(e || 'sync failed'),
        at: Date.now(),
      });
    }
    results.push(row);
    currentJob.perConversation.push(row);
    currentJob.okCount = results.filter((r) => r.ok).length;
    currentJob.failCount = results.length - currentJob.okCount;
    await persistCurrentJob({
      currentConversationId: conversationId,
      currentConversationTitle: undefined,
      currentStage: 'finishing_current_item',
    });
  }

  currentJob.status = 'done';
  currentJob.finishedAt = Date.now();
  await persistCurrentJob({
    currentConversationId: undefined,
    currentConversationTitle: undefined,
    currentStage: undefined,
  });

  return buildSyncSummary(results, instanceId);
}

const api = { testConnection, getSyncStatus, clearSyncStatus, syncConversations };

export { testConnection, getSyncStatus, clearSyncStatus, syncConversations };
export default api;

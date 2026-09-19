import { parseArticleCommentDtos, type ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { backgroundStorage as defaultBackgroundStorage } from '@services/conversations/background/storage';
import { getObsidianConnectionConfig, getObsidianPathConfig } from '@services/sync/obsidian/settings-store';
import {
  NOTE_JSON_ACCEPT,
  createClient as createDefaultObsidianClient,
} from '@services/sync/obsidian/obsidian-local-rest-client.ts';
import { buildFullNoteMarkdown as buildDefaultFullNoteMarkdown } from '@services/sync/shared/remote-markdown-writer.ts';
import {
  buildStableNotePath as buildDefaultStableNotePath,
  resolveExistingNotePath as resolveDefaultExistingNotePath,
} from '@services/sync/obsidian/obsidian-note-path.ts';
import {
  buildSyncnosObject as buildDefaultSyncnosObject,
  readSyncnosObject as readDefaultSyncnosObject,
} from '@services/sync/shared/remote-markdown-metadata.ts';
import { createSyncJobStore } from '@services/sync/sync-job-store';
import { getImageCacheAssetsByIds } from '@services/conversations/data/image-cache-read';
import { downloadChatgptImagesForStoredConversation } from '@services/integrations/chatgpt/conversation-image-assets';
import {
  buildChatgptFileCacheKey,
  chatgptFileIdFromUrl,
  hasChatgptFileScheme,
} from '@services/shared/chatgpt-image-identity';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';
import { createSyncJobId, createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
import { createSyncRunOwnership } from '@services/sync/sync-run-ownership';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

const SYNC_PROVIDER = 'obsidian';
const obsidianSyncJobStore = createSyncJobStore(SYNC_PROVIDER);
const obsidianSyncOwnership = createSyncRunOwnership();

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
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
  conversationId,
  filePath,
  markdown,
  indexScopeMarkdown,
}: {
  client: any;
  conversationId: number;
  filePath: string;
  markdown: string;
  indexScopeMarkdown?: string;
}): Promise<string> {
  const targetMarkdown = String(markdown || '');
  if (!targetMarkdown) return targetMarkdown;
  if (!client || typeof client.putVaultBinaryFile !== 'function') {
    throw new Error('obsidian client does not support binary attachment upload');
  }

  const internalReferences = collectMarkdownImageReferences(targetMarkdown).filter(
    (reference) => isSyncnosAssetUrl(reference.target) || hasChatgptFileScheme(reference.target),
  );
  if (!internalReferences.length) return targetMarkdown;

  const safeConversationId = Number(conversationId);
  if (!Number.isSafeInteger(safeConversationId) || safeConversationId <= 0) {
    throw new Error('invalid conversation id for image materialization');
  }

  const targetAssetIds: number[] = [];
  const seenAssetIds = new Set<number>();
  const targetChatgptFileIds: string[] = [];
  const seenChatgptFileIds = new Set<string>();
  for (const reference of internalReferences) {
    if (isSyncnosAssetUrl(reference.target)) {
      const assetId = parseSyncnosAssetId(reference.target);
      if (assetId == null) throw new Error('invalid SyncNos asset target');
      if (!seenAssetIds.has(assetId)) {
        seenAssetIds.add(assetId);
        targetAssetIds.push(assetId);
      }
      continue;
    }
    const fileId = chatgptFileIdFromUrl(reference.target);
    if (!fileId) continue;
    if (!seenChatgptFileIds.has(fileId)) {
      seenChatgptFileIds.add(fileId);
      targetChatgptFileIds.push(fileId);
    }
  }

  const scopeKeys: string[] = [];
  const seenScopeKeys = new Set<string>();
  for (const reference of collectMarkdownImageReferences(indexScopeMarkdown || targetMarkdown)) {
    const assetId = parseSyncnosAssetId(reference.target);
    const fileId = chatgptFileIdFromUrl(reference.target);
    const key = assetId != null ? `asset:${assetId}` : fileId ? `chatgpt:${fileId}` : '';
    if (!key || seenScopeKeys.has(key)) continue;
    seenScopeKeys.add(key);
    scopeKeys.push(key);
  }
  const indexByKey = new Map(scopeKeys.map((key, index) => [key, index + 1] as const));

  const assetsById = targetAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: targetAssetIds, conversationId: safeConversationId })
    : new Map();
  for (const assetId of targetAssetIds) {
    const asset = assetsById.get(assetId);
    if (!asset || !(asset.blob instanceof Blob)) throw new Error(`missing local asset blob: ${assetId}`);
  }

  const chatgptImageByFileId = new Map<
    string,
    Awaited<ReturnType<typeof downloadChatgptImagesForStoredConversation>>[number]
  >();
  if (targetChatgptFileIds.length) {
    const downloaded = await downloadChatgptImagesForStoredConversation({
      conversationId: safeConversationId,
      fileIds: targetChatgptFileIds,
      concurrency: 4,
    });
    targetChatgptFileIds.forEach((fileId, index) => {
      const image = downloaded[index];
      if (image) chatgptImageByFileId.set(fileId, image);
    });
  }

  const noteBase = buildNoteBasenameFromFilePath(filePath);
  const replacementByTarget = new Map<string, string>();
  const upload = async (key: string, sourceTarget: string, blob: Blob, contentType: string, ext: string) => {
    const index = indexByKey.get(key);
    if (!index) throw new Error(`missing asset index mapping: ${key}`);
    const attachmentName = `${noteBase}-${index}.${ext}`;
    const putRes = await client.putVaultBinaryFile(
      buildAttachmentPath(filePath, attachmentName),
      new Uint8Array(await blob.arrayBuffer()),
      { contentType },
    );
    if (!putRes || !putRes.ok) {
      const message = putRes && putRes.error && putRes.error.message ? putRes.error.message : 'attachment put failed';
      throw new Error(String(message || 'attachment put failed'));
    }
    replacementByTarget.set(sourceTarget, attachmentName);
  };

  for (const assetId of targetAssetIds) {
    const asset = assetsById.get(assetId)!;
    const ext = inferImageExtFromAsset(asset);
    await upload(
      `asset:${assetId}`,
      `syncnos-asset://${assetId}`,
      asset.blob,
      safeString(asset.contentType || asset.blob.type) || `image/${ext}`,
      ext,
    );
  }
  for (const fileId of targetChatgptFileIds) {
    const image = chatgptImageByFileId.get(fileId);
    if (!image?.ok) continue;
    const ext = inferImageExtFromAsset({ contentType: image.contentType, url: '' });
    try {
      await upload(
        `chatgpt:${fileId}`,
        buildChatgptFileCacheKey(fileId),
        image.blob,
        safeString(image.contentType) || `image/${ext}`,
        ext,
      );
    } catch (_error) {
      // Remote ChatGPT images are optional for text sync; leave a placeholder below.
    }
  }

  return replaceMarkdownImageReferences(targetMarkdown, internalReferences, (reference) => {
    const target = replacementByTarget.get(reference.target);
    if (target) return { target };
    if (hasChatgptFileScheme(reference.target)) return { replacement: '[Image unavailable]' };
    return null;
  });
}

function buildJobPersistenceError() {
  return Object.assign(new Error('obsidian sync job persistence failed'), { code: 'obsidian_sync_job_persist_failed' });
}

function toCurrentConversationTitle(convo: any) {
  return safeString(convo && convo.title);
}

async function buildClient() {
  const conn = await getObsidianConnectionConfig();
  if (!conn || !conn.apiKey) {
    return { ok: false, error: { code: 'missing_api_key', message: 'Obsidian API Key is required.' } };
  }

  const client = createDefaultObsidianClient(conn);
  if (!client || client.ok === false) {
    return {
      ok: false,
      error: client && client.error ? client.error : { code: 'invalid_client', message: 'invalid client' },
    };
  }
  return {
    ok: true,
    client,
    noteJsonAccept: NOTE_JSON_ACCEPT,
  };
}

async function decideSyncModeForConversation({
  conversationId,
  forceFull,
  onConversationLoaded,
}: {
  conversationId: number;
  forceFull?: boolean;
  onConversationLoaded?: (conversation: any) => void | Promise<void>;
}) {
  let convo = await defaultBackgroundStorage.getConversationById(conversationId);
  if (convo && onConversationLoaded) await onConversationLoaded(convo);
  if (!convo) {
    return {
      isFinal: true,
      row: {
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: 'conversation not found',
        at: Date.now(),
      },
    };
  }

  const messages = await defaultBackgroundStorage.getMessagesByConversationId(conversationId);
  if (!Array.isArray(messages) || !messages.length) {
    return {
      isFinal: true,
      row: {
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo),
        ok: false,
        mode: 'empty',
        appended: 0,
        error: 'No messages to sync.',
        at: Date.now(),
      },
    };
  }

  const isArticle = safeString(convo?.sourceType) === 'article';
  let articleComments: ArticleCommentDto[] = [];
  if (isArticle) {
    const canonicalUrl = safeString(convo?.url);
    if (canonicalUrl) {
      const attached = await defaultBackgroundStorage.attachOrphanArticleCommentsToConversation(
        canonicalUrl,
        conversationId,
      );
      if (Number(attached?.updated) > 0) {
        const refreshed = await defaultBackgroundStorage.getConversationById(conversationId);
        if (!refreshed) throw new Error('conversation not found after comment attach');
        convo = refreshed;
      }
    }
    articleComments = parseArticleCommentDtos(
      await defaultBackgroundStorage.getArticleCommentsByConversationId(conversationId),
    );
  }

  const pathConfig = await getObsidianPathConfig();
  const folderByKindId = pathConfig
    ? {
        chat: safeString(pathConfig.chatFolder),
        article: safeString(pathConfig.articleFolder),
        video: safeString((pathConfig as any)?.videoFolder),
      }
    : undefined;

  const clientRes: any = await buildClient();
  if (!clientRes.ok) {
    return {
      isFinal: true,
      row: {
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: clientRes.error && clientRes.error.message ? clientRes.error.message : 'client error',
        at: Date.now(),
      },
    };
  }
  const client = clientRes.client;
  const accept = clientRes.noteJsonAccept || client.NOTE_JSON_ACCEPT || NOTE_JSON_ACCEPT;

  let existingRemote: any = null;
  let existingPath = '';
  let deleteAfterFilePath = '';

  const pathResolution = await resolveDefaultExistingNotePath({
    conversation: convo,
    client,
    noteJsonAccept: accept,
    folderByKindId,
    readSyncnosObject: readDefaultSyncnosObject,
  });

  if (pathResolution && !pathResolution.ok) {
    return {
      isFinal: true,
      row: {
        conversationId: Number(conversationId),
        conversationTitle: toCurrentConversationTitle(convo),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: pathResolution.error?.message ? String(pathResolution.error.message) : 'remote error',
        at: Date.now(),
      },
    };
  }

  const desiredFilePath =
    safeString(pathResolution?.desiredFilePath) || buildDefaultStableNotePath(convo, { folderByKindId });
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
      comments: articleComments,
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
      comments: articleComments,
      mode: forceFull ? 'full_rebuild_forced' : 'full_rebuild_rename',
    };
  }

  if (forceFull) {
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath: desiredFilePath,
      messages,
      comments: articleComments,
      mode: 'full_rebuild_forced',
    };
  }

  const note = existingRemote.data && typeof existingRemote.data === 'object' ? existingRemote.data : null;
  const frontmatter = note && note.frontmatter && typeof note.frontmatter === 'object' ? note.frontmatter : null;

  const parsed = readDefaultSyncnosObject(frontmatter);
  const parsedData = parsed && parsed.ok && parsed.data ? parsed.data : null;
  if (!parsedData) {
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath: desiredFilePath,
      messages,
      comments: articleComments,
      mode: 'full_rebuild',
    };
  }
  if (
    safeString(parsedData.source) !== safeString(convo.source) ||
    safeString(parsedData.conversationKey) !== safeString(convo.conversationKey)
  ) {
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath: desiredFilePath,
      messages,
      comments: articleComments,
      mode: 'full_rebuild',
    };
  }

  return {
    isFinal: false,
    conversationId,
    convo,
    filePath: desiredFilePath,
    messages,
    comments: articleComments,
    mode: 'full_rebuild',
  };
}

async function testConnection({ instanceId }: { instanceId?: string } = {}) {
  const conn = await getObsidianConnectionConfig();
  if (!conn || !conn.apiKey) {
    return {
      ok: false,
      error: { code: 'missing_api_key', message: 'Obsidian API Key is required.' },
      message: 'missing api key',
      instanceId: safeString(instanceId),
    };
  }

  const client = createDefaultObsidianClient(conn);
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

async function getSyncStatus() {
  return { provider: SYNC_PROVIDER, job: await obsidianSyncJobStore.getJob() };
}

function clearSyncStatus() {
  return obsidianSyncOwnership.runExclusiveMutation(async () => {
    if (!(await obsidianSyncJobStore.setJob(null))) throw buildJobPersistenceError();
    return { provider: SYNC_PROVIDER, job: null };
  });
}

function reconcileStartupSyncJob() {
  return obsidianSyncOwnership.runExclusiveMutation(() => obsidianSyncJobStore.abortRunningJob());
}

async function runSyncConversations({
  conversationIds,
  forceFullConversationIds,
  instanceId,
  jobId,
}: {
  conversationIds?: unknown[];
  forceFullConversationIds?: unknown[];
  instanceId?: string;
  jobId?: string;
} = {}) {
  const ids = normalizeSyncConversationIds(conversationIds);
  const forceFullIds = new Set(normalizeSyncConversationIds(forceFullConversationIds));
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
  const startedAt = Date.now();
  const acceptedJobId = safeString(jobId) || createSyncJobId(startedAt);
  const lifecycle = createSyncJobLifecycle({
    initialJob: {
      id: acceptedJobId,
      provider: SYNC_PROVIDER,
      instanceId: safeInstanceId,
      status: 'running',
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      totalCount: ids.length,
      conversationIds: [],
      currentStage: 'preparing_queue',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    },
    configuredConversationIds: ids,
    persist: (job) => obsidianSyncJobStore.setJob(job),
  });

  if (!(await lifecycle.setRunStage('preparing_queue'))) throw buildJobPersistenceError();

  for (const conversationId of ids) {
    let row: any = null;
    try {
      const decision: any = await decideSyncModeForConversation({
        conversationId,
        forceFull: forceFullIds.has(conversationId),
        onConversationLoaded: async (conversation) => {
          await lifecycle.setItem(conversationId, {
            conversationTitle: toCurrentConversationTitle(conversation),
            currentStage: 'preparing_sync',
          });
        },
      });
      if (decision && decision.isFinal) {
        row = decision.row;
      } else if (decision && decision.mode && decision.conversationId) {
        const clientRes: any = await buildClient();
        const client = clientRes.ok ? clientRes.client : null;
        const currentTitle = toCurrentConversationTitle(decision.convo);

        if (!clientRes.ok || !client) {
          row = {
            conversationId,
            conversationTitle: currentTitle,
            ok: false,
            mode: 'failed',
            appended: 0,
            error: clientRes.error && clientRes.error.message ? clientRes.error.message : 'client error',
            at: Date.now(),
          };
        } else if (
          decision.mode === 'full_rebuild' ||
          decision.mode === 'full_rebuild_forced' ||
          decision.mode === 'full_rebuild_rename'
        ) {
          const syncnosObject = buildDefaultSyncnosObject({
            conversation: decision.convo,
            lastSyncedAt: Date.now(),
          });
          const rawMarkdown = buildDefaultFullNoteMarkdown({
            conversation: decision.convo,
            messages: decision.messages,
            syncnosObject,
            comments: (decision as any).comments || [],
          });
          const markdown = await materializeMarkdownAssetsForObsidian({
            client,
            conversationId: decision.conversationId,
            filePath: decision.filePath,
            markdown: rawMarkdown,
            indexScopeMarkdown: rawMarkdown,
          });
          const putRes = await client.putVaultFile(decision.filePath, markdown);
          if (!putRes || !putRes.ok) {
            row = {
              conversationId,
              conversationTitle: currentTitle,
              ok: false,
              mode: 'failed',
              appended: 0,
              error: putRes && putRes.error && putRes.error.message ? putRes.error.message : 'put failed',
              at: Date.now(),
            };
          } else {
            await defaultBackgroundStorage.recordObsidianRemoteWrite({
              source: decision.convo?.source,
              conversationKey: decision.convo?.conversationKey,
            });
            const deleteAfter = decision.deleteAfterFilePath ? safeString(decision.deleteAfterFilePath) : '';
            if (
              deleteAfter &&
              deleteAfter !== safeString(decision.filePath) &&
              typeof client.deleteVaultFile === 'function'
            ) {
              try {
                const delRes = await client.deleteVaultFile(deleteAfter);
                if (!delRes || !delRes.ok) {
                  row = {
                    conversationId,
                    conversationTitle: currentTitle,
                    ok: false,
                    mode: 'rename_delete_failed',
                    appended: decision.messages.length,
                    error: delRes && delRes.error && delRes.error.message ? delRes.error.message : 'delete failed',
                    at: Date.now(),
                  };
                } else {
                  row = {
                    conversationId,
                    conversationTitle: currentTitle,
                    ok: true,
                    mode: decision.mode,
                    appended: decision.messages.length,
                    error: '',
                    at: Date.now(),
                  };
                }
              } catch (error) {
                row = {
                  conversationId,
                  conversationTitle: currentTitle,
                  ok: false,
                  mode: 'rename_delete_failed',
                  appended: decision.messages.length,
                  error: error instanceof Error ? error.message : String(error || 'delete failed'),
                  at: Date.now(),
                };
              }
            } else {
              row = {
                conversationId,
                conversationTitle: currentTitle,
                ok: true,
                mode: decision.mode,
                appended: decision.messages.length,
                error: '',
                at: Date.now(),
              };
            }
          }
        } else {
          row = {
            conversationId,
            conversationTitle: currentTitle,
            ok: false,
            mode: 'failed',
            appended: 0,
            error: 'unknown mode',
            at: Date.now(),
          };
        }
      } else if (decision && decision.row) {
        row = decision.row;
      } else {
        row = {
          conversationId,
          conversationTitle: lifecycle.titleFor(conversationId),
          ok: false,
          mode: 'failed',
          appended: 0,
          error: 'invalid decision',
          at: Date.now(),
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

function syncConversations(input: Parameters<typeof runSyncConversations>[0] = {}) {
  return obsidianSyncOwnership.startRun(() => runSyncConversations(input));
}

const isRunActive = () => obsidianSyncOwnership.isRunActive();

export { testConnection, getSyncStatus, clearSyncStatus, syncConversations, isRunActive, reconcileStartupSyncJob };

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
import {
  collectOrderedSyncnosAssetIds,
  replaceSyncnosAssetImageTargets,
} from '@services/sync/shared/markdown-asset-refs';
import { createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
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
  const assetsById = await getImageCacheAssetsByIds({ ids: targetIds });

  const noteBase = buildNoteBasenameFromFilePath(filePath);
  const attachmentNameByAssetId = new Map<number, string>();

  for (const assetId of targetIds) {
    const index = indexByAssetId.get(assetId);
    if (!index) throw new Error(`missing asset index mapping: ${assetId}`);

    const asset = assetsById.get(assetId);
    if (!asset || !(asset.blob instanceof Blob)) throw new Error(`missing local asset blob: ${assetId}`);

    const ext = inferImageExtFromAsset(asset);
    const attachmentName = `${noteBase}-${index}.${ext}`;
    attachmentNameByAssetId.set(assetId, attachmentName);

    const contentType = safeString(asset.contentType || asset.blob.type) || `image/${ext}`;

    const bytes = new Uint8Array(await asset.blob.arrayBuffer());

    const putRes = await client.putVaultBinaryFile(buildAttachmentPath(filePath, attachmentName), bytes, {
      contentType,
    });
    if (!putRes || !putRes.ok) {
      const message = putRes && putRes.error && putRes.error.message ? putRes.error.message : 'attachment put failed';
      throw new Error(String(message || 'attachment put failed'));
    }
  }

  return replaceSyncnosAssetImageTargets(targetMarkdown, attachmentNameByAssetId);
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
  const convo = await defaultBackgroundStorage.getConversationById(conversationId);
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
      await defaultBackgroundStorage.attachOrphanArticleCommentsToConversation(canonicalUrl, conversationId);
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
}: {
  conversationIds?: unknown[];
  forceFullConversationIds?: unknown[];
  instanceId?: string;
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
  const lifecycle = createSyncJobLifecycle({
    initialJob: {
      id: `${startedAt}_${Math.random().toString(16).slice(2)}`,
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

  await lifecycle.setRunStage('preparing_queue');

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

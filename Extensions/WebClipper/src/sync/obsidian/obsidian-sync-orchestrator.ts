import { backgroundStorage as defaultBackgroundStorage } from '../../conversations/background-storage';
import {
  getObsidianConnectionConfig,
  getObsidianPathConfig,
} from './settings-store';
import runtimeContext from '../../runtime-context.ts';
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
import { buildStableNotePath as buildDefaultStableNotePath } from './obsidian-note-path.ts';
import {
  stableConversationHash16,
  stableConversationId10 as stableConversationId10Fallback,
} from '../../conversations/file-naming';
import {
  buildSyncnosObject as buildDefaultSyncnosObject,
  readSyncnosObject as readDefaultSyncnosObject,
} from './obsidian-sync-metadata.ts';

const NS = runtimeContext as any;

let currentJob: any = null;

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function normalizeIds(list: unknown) {
  const ids = Array.isArray(list) ? list : [];
  return Array.from(
    new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)),
  );
}

function buildPerConversationResult({
  conversationId,
  ok,
  mode,
  appended,
  error,
  at,
}: {
  conversationId: number;
  ok: unknown;
  mode: unknown;
  appended: unknown;
  error: unknown;
  at: unknown;
}) {
  return {
    conversationId,
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
    .map((r) => ({ conversationId: r.conversationId, error: r.error || 'unknown error' }));
  return { okCount, failCount, failures, results, instanceId: safeString(instanceId) };
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
  const storage = NS.backgroundStorage;
  if (
    storage &&
    typeof storage.getConversationById === 'function' &&
    typeof storage.getMessagesByConversationId === 'function'
  ) {
    return storage;
  }
  return defaultBackgroundStorage;
}

function getSettingsStoreModule() {
  const store = NS.obsidianSettingsStore;
  if (
    store &&
    typeof store.getConnectionConfig === 'function' &&
    typeof store.getPathConfig === 'function'
  ) {
    return store;
  }
  return {
    getConnectionConfig: getObsidianConnectionConfig,
    getPathConfig: getObsidianPathConfig,
  };
}

function getLocalRestClientModule() {
  const clientMod = NS.obsidianLocalRestClient;
  if (clientMod && typeof clientMod.createClient === 'function') return clientMod;
  return {
    createClient: createDefaultObsidianClient,
    NOTE_JSON_ACCEPT,
  };
}

function getNotePathModule() {
  const notePathMod = NS.obsidianNotePath;
  if (notePathMod && typeof notePathMod.buildStableNotePath === 'function') return notePathMod;
  return {
    buildStableNotePath: buildDefaultStableNotePath,
  };
}

function getSyncMetadataModule() {
  const metaMod = NS.obsidianSyncMetadata;
  if (
    metaMod &&
    typeof metaMod.readSyncnosObject === 'function' &&
    typeof metaMod.buildSyncnosObject === 'function'
  ) {
    return metaMod;
  }
  return {
    readSyncnosObject: readDefaultSyncnosObject,
    buildSyncnosObject: buildDefaultSyncnosObject,
  };
}

function getMarkdownWriterModule() {
  const writer = NS.obsidianMarkdownWriter;
  if (
    writer &&
    typeof writer.buildFullNoteMarkdown === 'function' &&
    typeof writer.buildIncrementalAppendMarkdown === 'function' &&
    typeof writer.appendUnderMessagesHeading === 'function' &&
    typeof writer.replaceSyncnosFrontmatter === 'function'
  ) {
    return writer;
  }
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
  conversationId?: number;
  forceFull?: boolean;
} = {}) {
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
    : null;
  const desiredFilePath = notePathMod.buildStableNotePath(convo, { folderByKindId });
  const desiredFolder = (() => {
    const p = safeString(desiredFilePath);
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : '';
  })();
  const legacyHashFilePath =
    notePathMod && typeof (notePathMod as any).buildLegacyHashNotePath === 'function'
      ? (notePathMod as any).buildLegacyHashNotePath(convo, { folderByKindId })
      : (() => {
          const source = safeString(convo && (convo as any).source) || 'unknown';
          const id = stableConversationHash16(convo);
          const filename = `${source}-${id}.md`;
          return desiredFolder ? `${desiredFolder}/${filename}` : filename;
        })();
  const stableId10 =
    notePathMod && typeof (notePathMod as any).stableConversationId10 === 'function'
      ? safeString((notePathMod as any).stableConversationId10(convo))
      : stableConversationId10Fallback(convo);

  const clientRes: any = await buildClient();
  if (!clientRes.ok) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
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

  async function tryGetNote(path: string) {
    const p = safeString(path);
    if (!p) return null;
    const r = await client.getVaultFile(p, { accept });
    if (r && r.ok) return r;
    if (r && r.status === 404) return null;
    throw new Error(r && r.error && r.error.message ? r.error.message : 'remote error');
  }

  let existingRemote: any = null;
  let existingPath = '';
  let deleteAfterFilePath = '';

  try {
    existingRemote = await tryGetNote(desiredFilePath);
    existingPath = existingRemote ? desiredFilePath : '';

    if (!existingRemote && legacyHashFilePath && legacyHashFilePath !== desiredFilePath) {
      existingRemote = await tryGetNote(legacyHashFilePath);
      if (existingRemote) {
        existingPath = legacyHashFilePath;
      }
    }

    if (!existingRemote && desiredFolder && stableId10 && typeof client.listVaultDir === 'function') {
      const listRes = await client.listVaultDir(desiredFolder);
      const raw = listRes && listRes.ok && listRes.data && typeof listRes.data === 'object' ? listRes.data : null;
      const files = raw && Array.isArray((raw as any).files) ? (raw as any).files : [];
      const suffix = `-${stableId10}.md`.toLowerCase();
      const candidates = files
        .map((x: any) => safeString(x))
        .filter((x: string) => !!x && !x.endsWith('/') && x.toLowerCase().endsWith(suffix));

      for (const entry of candidates) {
        const fullPath = entry.includes('/') ? entry : desiredFolder ? `${desiredFolder}/${entry}` : entry;
        if (!fullPath || fullPath === desiredFilePath) continue;
        // eslint-disable-next-line no-await-in-loop
        const r = await tryGetNote(fullPath);
        if (!r) continue;
        const note = r.data && typeof r.data === 'object' ? r.data : null;
        const frontmatter =
          note && note.frontmatter && typeof note.frontmatter === 'object' ? note.frontmatter : null;
        const parsed = metaMod.readSyncnosObject(frontmatter);
        if (
          parsed &&
          parsed.ok &&
          parsed.data &&
          parsed.data.source === safeString(convo.source) &&
          parsed.data.conversationKey === safeString(convo.conversationKey)
        ) {
          existingRemote = r;
          existingPath = fullPath;
          break;
        }
      }
    }
  } catch (e: any) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
        ok: false,
        mode: 'failed',
        appended: 0,
        error: e?.message ? String(e.message) : String(e || 'remote error'),
        at: Date.now(),
      }),
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
  if (!parsed.ok) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }
  if (
    parsed.data.source !== safeString(convo.source) ||
    parsed.data.conversationKey !== safeString(convo.conversationKey)
  ) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }

  const delta = computeDelta(messages, parsed.data);
  if (!delta.ok) {
    return { isFinal: false, conversationId, convo, filePath: desiredFilePath, messages, mode: 'full_rebuild' };
  }
  const newMessages = Array.isArray(delta.newMessages) ? delta.newMessages : [];
  if (!newMessages.length) {
    return {
      isFinal: true,
      row: buildPerConversationResult({
        conversationId: Number(conversationId),
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
      instanceId: safeString(instanceId),
    };
  }

  const clientMod = getLocalRestClientModule();
  const client = clientMod.createClient(conn);
  if (!client || client.ok === false) {
    return {
      ok: false,
      error: client && client.error ? client.error : { code: 'invalid_client', message: 'invalid client' },
      instanceId: safeString(instanceId),
    };
  }

  const res = await client.getServerStatus();
  if (!res || !res.ok) {
    return {
      ok: false,
      error: res && res.error ? res.error : { code: 'network_error', message: 'connection failed' },
      instanceId: safeString(instanceId),
    };
  }

  return { ok: true, data: res.data || null, instanceId: safeString(instanceId) };
}

function getSyncStatus({ instanceId }: { instanceId?: string } = {}) {
  return { job: currentJob, instanceId: safeString(instanceId) };
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
    return { okCount: 0, failCount: 0, failures: [], results: [], instanceId: safeString(instanceId) };
  }

  currentJob = {
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    conversationIds: ids,
    perConversation: [],
  };

  const results: any[] = [];

  for (const conversationId of ids) {
    let row: any = null;
    try {
      const decision: any = await decideSyncModeForConversation({
        conversationId,
        forceFull: forceFullIds.has(conversationId),
      });
      if (decision && decision.isFinal) {
        row = decision.row;
      } else if (decision && decision.mode && decision.conversationId) {
        const writer = getMarkdownWriterModule();
        const metaMod = getSyncMetadataModule();
        const clientRes: any = await buildClient();
        const client = clientRes.ok ? clientRes.client : null;

        if (!clientRes.ok || !client) {
          row = buildPerConversationResult({
            conversationId,
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
          const syncnosObject = metaMod.buildSyncnosObject({
            conversation: decision.convo,
            cursor: pickLocalCursor(decision.messages),
          });
          const markdown = writer.buildFullNoteMarkdown({
            conversation: decision.convo,
            messages: decision.messages,
            syncnosObject,
          });
          const putRes = await client.putVaultFile(decision.filePath, markdown);
          if (!putRes || !putRes.ok) {
            row = buildPerConversationResult({
              conversationId,
              ok: false,
              mode: 'failed',
              appended: 0,
              error: putRes && putRes.error && putRes.error.message ? putRes.error.message : 'put failed',
              at: Date.now(),
            });
          } else {
            const deleteAfter = decision.deleteAfterFilePath ? safeString(decision.deleteAfterFilePath) : '';
            if (deleteAfter && deleteAfter !== safeString(decision.filePath) && typeof client.deleteVaultFile === 'function') {
              const delRes = await client.deleteVaultFile(deleteAfter);
              if (!delRes || !delRes.ok) {
                row = buildPerConversationResult({
                  conversationId,
                  ok: false,
                  mode: 'rename_delete_failed',
                  appended: decision.messages.length,
                  error: delRes && delRes.error && delRes.error.message ? delRes.error.message : 'delete failed',
                  at: Date.now(),
                });
              } else {
                row = buildPerConversationResult({
                  conversationId,
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
                ok: true,
                mode: decision.mode,
                appended: decision.messages.length,
                error: '',
                at: Date.now(),
              });
            }
          }
        } else if (decision.mode === 'incremental_append') {
          const chunk = writer.buildIncrementalAppendMarkdown({ newMessages: decision.newMessages });
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
              ok: false,
              mode: 'failed',
              appended: 0,
              error: patchRes.error && patchRes.error.message ? patchRes.error.message : 'patch failed',
              at: Date.now(),
            });
          } else if (!patchRes.ok && isPatchFailed && !isIdempotentDup) {
            const syncnosObject = metaMod.buildSyncnosObject({
              conversation: decision.convo,
              cursor: pickLocalCursor(decision.messages),
            });
            const markdown = writer.buildFullNoteMarkdown({
              conversation: decision.convo,
              messages: decision.messages,
              syncnosObject,
            });
            const putRes = await client.putVaultFile(decision.filePath, markdown);
            if (!putRes || !putRes.ok) {
              row = buildPerConversationResult({
                conversationId,
                ok: false,
                mode: 'failed',
                appended: 0,
                error: putRes && putRes.error && putRes.error.message ? putRes.error.message : 'put failed',
                at: Date.now(),
              });
            } else {
              row = buildPerConversationResult({
                conversationId,
                ok: true,
                mode: 'full_rebuild_fallback',
                appended: decision.messages.length,
                error: '',
                at: Date.now(),
              });
            }
          } else {
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
        ok: false,
        mode: 'failed',
        appended: 0,
        error: e && e.message ? e.message : String(e || 'sync failed'),
        at: Date.now(),
      });
    }
    results.push(row);
    currentJob.perConversation.push(row);
  }

  currentJob.status = 'finished';
  currentJob.finishedAt = Date.now();

  return buildSyncSummary(results, instanceId);
}

const api = { testConnection, getSyncStatus, syncConversations };

NS.obsidianSyncOrchestrator = api;

export { testConnection, getSyncStatus, syncConversations };
export default api;

// @ts-nocheck
import type { NotionServices } from './notion-services.ts';
import { backgroundStorage as defaultBackgroundStorage } from '../../conversations/background-storage';
import { getNotionOAuthToken } from './auth/token-store';
import { conversationKinds as builtInConversationKinds } from '../../protocols/conversation-kinds.ts';
import notionDbManagerDefault from './notion-db-manager.ts';
import notionSyncJobStoreDefault from './notion-sync-job-store.ts';
import notionSyncServiceDefault from './notion-sync-service.ts';
import notionApiDefault from './notion-api.ts';
import notionFilesApiDefault from './notion-files-api.ts';
import { computeNewMessages, extractCursor, lastMessageCursor } from './notion-sync-cursor.ts';

  function toConvoLabel(convo) {
    if (!convo) return "(missing conversation)";
    const t = convo.title || "";
    return t ? `"${t}"` : `conversation#${convo.id || "?"}`;
  }

  function isObjectNotFoundError(error) {
    const message = error && error.message ? String(error.message) : String(error || "");
    if (!message) return false;
    return message.includes("object_not_found");
  }

  function isMissingDatabaseError(error) {
    const message = error && error.message ? String(error.message) : String(error || "");
    if (!message) return false;
    if (!isObjectNotFoundError(error)) return false;
    return message.toLowerCase().includes("database");
  }

  function toPerConversationSnapshot(results) {
    return results.map((r) => ({
      conversationId: r.conversationId,
      ok: !!r.ok,
      mode: r.mode || (r.ok ? "ok" : "fail"),
      appended: Number(r.appended) || 0,
      error: r.error || "",
      at: Date.now()
    }));
  }

  function canUpgradeImageBlocks(notionSyncService, blocks) {
    if (!blocks || !blocks.length) return false;
    if (typeof notionSyncService.upgradeImageBlocksToFileUploads !== "function") return false;
    if (typeof notionSyncService.hasExternalImageBlocks === "function") {
      return notionSyncService.hasExternalImageBlocks(blocks);
    }
    return true;
  }

  async function buildBlocksForSync({ notionSyncService, accessToken, source, messagesList }) {
    let blocks = notionSyncService.messagesToBlocks(messagesList, { source });
    if (!canUpgradeImageBlocks(notionSyncService, blocks)) return blocks;
    try {
      blocks = await notionSyncService.upgradeImageBlocksToFileUploads(accessToken, blocks);
    } catch (_e) {
      // ignore (fallback: external images)
    }
    return blocks;
  }

  async function getNotionParentPageId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["notion_parent_page_id"], (res) => resolve((res && res.notion_parent_page_id) || ""));
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!Array.isArray(keys) || !keys.length) return resolve(false);
      if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.remove !== "function") return resolve(false);
      chrome.storage.local.remove(keys, () => resolve(true));
    });
  }

  async function clearCachedDatabaseId(notionDbManager, storageKey) {
    if (notionDbManager && typeof notionDbManager.clearCachedDatabaseId === "function") {
      await notionDbManager.clearCachedDatabaseId(storageKey);
      return true;
    }
    const explicit = String(storageKey || "").trim();
    const fallback = notionDbManager && notionDbManager.DEFAULT_DB_STORAGE_KEY
      ? String(notionDbManager.DEFAULT_DB_STORAGE_KEY).trim()
      : "notion_db_id_syncnos_ai_chats";
    const key = explicit || fallback;
    return storageRemove([key]);
  }

export function createNotionSyncOrchestrator(services: NotionServices) {
  const notionJobStore = services?.jobStore;
  const notionTokenStore = services?.tokenStore;
  const notionDbManager = services?.dbManager;
  const notionSyncService = services?.syncService;
  const storage = services?.storage;
  const conversationKinds = services?.conversationKinds;

  async function getSyncJobStatus(input) {
    const instanceId = input && input.instanceId != null ? String(input.instanceId) : '';
    if (!notionJobStore || typeof notionJobStore.abortRunningJobIfFromOtherInstance !== "function") {
      throw new Error("notion sync job store missing");
    }
    const job = await notionJobStore.abortRunningJobIfFromOtherInstance(instanceId);
    return { job };
  }

  async function syncConversations(input) {
    const instanceId = input && input.instanceId != null ? String(input.instanceId) : '';
    const conversationIds = input ? input.conversationIds : undefined;
    if (
      !notionJobStore ||
      typeof notionJobStore.abortRunningJobIfFromOtherInstance !== "function" ||
      typeof notionJobStore.isRunningJob !== "function" ||
      typeof notionJobStore.setJob !== "function"
    ) {
      throw new Error("notion sync job store missing");
    }

    const existingJob = await notionJobStore.abortRunningJobIfFromOtherInstance(instanceId);
    if (notionJobStore.isRunningJob(existingJob)) throw new Error("sync already in progress");

    const token = await (notionTokenStore && notionTokenStore.getToken ? notionTokenStore.getToken() : Promise.resolve(null));
    if (!token || !token.accessToken) throw new Error("notion not connected");

    const parentPageId = await getNotionParentPageId();
    if (!parentPageId) throw new Error("missing parentPageId");

    const ids = Array.isArray(conversationIds) ? conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : [];
    if (!ids.length) throw new Error("no conversationIds");

    if (!storage) throw new Error("storage module missing");
    if (!notionSyncService) throw new Error("notion sync service missing");
    if (!notionDbManager || !notionDbManager.ensureDatabase) throw new Error("notion db manager missing");
    if (!conversationKinds || typeof conversationKinds.pick !== "function") throw new Error("conversation kinds missing");

    const dbIdByKindId = new Map();
    const recoveredMissingDbByStorageKey = new Set();

    async function ensureDbForKind(kind) {
      const existing = dbIdByKindId.get(kind.id);
      if (existing) return String(existing);
      const spec = kind && kind.notion && kind.notion.dbSpec ? kind.notion.dbSpec : null;
      if (!spec) throw new Error(`missing dbSpec for kind ${kind && kind.id ? kind.id : "?"}`);
      const db = await notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId, dbSpec: spec });
      const dbId = db && db.databaseId ? String(db.databaseId) : "";
      if (!dbId) throw new Error(`missing databaseId for kind ${kind.id}`);
      dbIdByKindId.set(kind.id, dbId);
      return dbId;
    }

    const results = [];
    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const jobStartedAt = Date.now();
    await notionJobStore.setJob({
      id: jobId,
      instanceId,
      status: "running",
      startedAt: jobStartedAt,
      updatedAt: jobStartedAt,
      conversationIds: ids,
      perConversation: []
    });

    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const mapped = await (storage.getSyncMappingByConversation ? storage.getSyncMappingByConversation(id) : Promise.resolve(null));
        const convo = mapped && mapped.conversation ? mapped.conversation : null;
        const mapping = mapped && mapped.mapping ? mapped.mapping : null;
        if (!convo) {
          results.push({ conversationId: id, ok: false, error: "conversation not found" });
          continue;
        }

        const kindPicked = conversationKinds.pick(convo);
        const kind = kindPicked || (typeof conversationKinds.list === "function"
          ? (conversationKinds.list() || []).find((d) => d && d.id === "chat")
          : null);
        if (!kind) throw new Error(`no conversation kind for ${toConvoLabel(convo)}`);
        const dbSpec = kind && kind.notion && kind.notion.dbSpec ? kind.notion.dbSpec : null;
        const pageSpec = kind && kind.notion && kind.notion.pageSpec ? kind.notion.pageSpec : null;
        if (!dbSpec || !dbSpec.storageKey) throw new Error(`missing notion dbSpec for kind ${kind.id}`);
        if (!pageSpec) throw new Error(`missing notion pageSpec for kind ${kind.id}`);

        let dbId = await ensureDbForKind(kind);

        // eslint-disable-next-line no-await-in-loop
        const messages = await storage.getMessagesByConversationId(id);
        const cursor = extractCursor(mapping);

        let pageId = "";
        if (mapping && mapping.notionPageId) pageId = String(mapping.notionPageId || "");
        if (!pageId && convo.notionPageId) pageId = String(convo.notionPageId || "");

        let pageUsable = false;
        if (pageId) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const page = await notionSyncService.getPage(token.accessToken, pageId);
            pageUsable = notionSyncService.isPageUsableForDatabase
              ? notionSyncService.isPageUsableForDatabase(page, dbId)
              : notionSyncService.pageBelongsToDatabase(page, dbId);
          } catch (_e) {
            pageUsable = false;
          }
          if (!pageUsable) pageId = "";
        }

        if (!pageId) {
          let created = null;
          try {
            // eslint-disable-next-line no-await-in-loop
            created = await notionSyncService.createPageInDatabase(token.accessToken, {
              databaseId: dbId,
              properties: pageSpec.buildCreateProperties(convo),
              capturedAt: convo.lastCapturedAt
            });
          } catch (createErr) {
            const shouldRecoverDb = !recoveredMissingDbByStorageKey.has(String(dbSpec.storageKey)) && isMissingDatabaseError(createErr);
            if (!shouldRecoverDb) throw createErr;
            recoveredMissingDbByStorageKey.add(String(dbSpec.storageKey));
            // Recover once by clearing stale DB cache and rebuilding under current parent page.
            // eslint-disable-next-line no-await-in-loop
            await clearCachedDatabaseId(notionDbManager, String(dbSpec.storageKey));
            // eslint-disable-next-line no-await-in-loop
            const rebuiltDb = await notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId, dbSpec });
            dbId = rebuiltDb && rebuiltDb.databaseId ? String(rebuiltDb.databaseId) : "";
            if (!dbId) throw createErr;
            dbIdByKindId.set(kind.id, dbId);
            // eslint-disable-next-line no-await-in-loop
            created = await notionSyncService.createPageInDatabase(token.accessToken, {
              databaseId: dbId,
              properties: pageSpec.buildCreateProperties(convo),
              capturedAt: convo.lastCapturedAt
            });
          }
          pageId = created && created.id ? created.id : "";
          if (!pageId) throw new Error("create page failed");

          // eslint-disable-next-line no-await-in-loop
          await storage.setConversationNotionPageId(id, pageId);
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: messages
          });
          if (blocks.length) {
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "created", appended: messages.length });
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }

        const inc = computeNewMessages(messages, cursor);
        let shouldRebuild = !!inc.rebuild;
        if (!shouldRebuild && pageSpec && typeof pageSpec.shouldRebuild === "function") {
          try {
            shouldRebuild = !!pageSpec.shouldRebuild({ conversation: convo, messages, mapping });
          } catch (_e) {
            // ignore
          }
        }

        if (shouldRebuild) {
          if (!messages.length) throw new Error(`missing cursor for ${toConvoLabel(convo)} and no local messages to rebuild`);
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.updatePageProperties(token.accessToken, {
            pageId,
            properties: pageSpec.buildUpdateProperties(convo)
          });
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.clearPageChildren(token.accessToken, pageId);
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: messages
          });
          if (blocks.length) {
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "rebuilt", appended: messages.length });
        } else if (inc.newMessages && inc.newMessages.length) {
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.updatePageProperties(token.accessToken, {
            pageId,
            properties: pageSpec.buildUpdateProperties(convo)
          });
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: inc.newMessages
          });
          if (blocks.length) {
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "appended", appended: inc.newMessages.length });
        } else {
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "no_changes", appended: 0 });
        }
      } catch (e) {
        results.push({ conversationId: id, ok: false, error: e && e.message ? e.message : String(e) });
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        await notionJobStore.setJob({
          id: jobId,
          instanceId,
          status: "running",
          startedAt: jobStartedAt,
          updatedAt: Date.now(),
          conversationIds: ids,
          perConversation: toPerConversationSnapshot(results)
        });
      } catch (_e) {
        // ignore
      }

      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const failures = results.filter((r) => !r.ok);
    await notionJobStore.setJob({
      id: jobId,
      instanceId,
      status: "done",
      startedAt: jobStartedAt,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      conversationIds: ids,
      okCount,
      failCount,
      perConversation: toPerConversationSnapshot(results)
    });
    return { results, okCount, failCount, failures, jobId };
  }

  return {
    getSyncJobStatus,
    syncConversations,
  };
}

function createDefaultNotionServices(): NotionServices {
  return {
    tokenStore: { getToken: getNotionOAuthToken },
    storage: defaultBackgroundStorage,
    conversationKinds: builtInConversationKinds,
    notionApi: notionApiDefault,
    notionFilesApi: notionFilesApiDefault,
    dbManager: notionDbManagerDefault,
    syncService: notionSyncServiceDefault,
    jobStore: notionSyncJobStoreDefault,
  };
}

const defaultOrchestrator = createNotionSyncOrchestrator(createDefaultNotionServices());

export async function getSyncJobStatus(input: { instanceId: string }) {
  return defaultOrchestrator.getSyncJobStatus(input as any);
}

export async function syncConversations(input: { conversationIds?: unknown[]; instanceId: string }) {
  return defaultOrchestrator.syncConversations(input as any);
}

export default defaultOrchestrator;

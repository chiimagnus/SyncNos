// @ts-nocheck
import type { NotionServices } from './notion-services.ts';
import { backgroundStorage as defaultBackgroundStorage } from '../../conversations/background/storage';
import { getNotionOAuthToken } from './auth/token-store';
import { conversationKinds as builtInConversationKinds } from '../../protocols/conversation-kinds.ts';
import notionDbManagerDefault from './notion-db-manager.ts';
import notionSyncJobStoreDefault from './notion-sync-job-store.ts';
import notionSyncServiceDefault from './notion-sync-service.ts';
import notionApiDefault from './notion-api.ts';
import notionFilesApiDefault from './notion-files-api.ts';
import { computeNewMessages, extractCursor, lastMessageCursor } from './notion-sync-cursor.ts';
import { storageGet, storageRemove } from '../../platform/storage/local';

const SYNC_PROVIDER = 'notion';
const SYNC_CONVERSATION_CONCURRENCY = 2;

  function notionTraceEnabled() {
    try {
      return !!(globalThis && globalThis.__SYNCNOS_NOTION_TRACE__);
    } catch (_e) {
      return false;
    }
  }

  function createConversationTrace(conversationId) {
    const enabled = notionTraceEnabled();
    const startedAt = Date.now();
    let lastAt = startedAt;
    const stages = [];

    function mark(stage) {
      if (!enabled) return;
      const now = Date.now();
      stages.push({
        stage: String(stage || "unknown"),
        elapsedMs: now - startedAt,
        sinceLastMs: now - lastAt,
      });
      lastAt = now;
    }

    function flush(meta = {}) {
      if (!enabled || !stages.length) return;
      try {
        console.debug("[SyncNos][NotionTrace]", {
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
      at: Number(r.at) || Date.now()
    }));
  }

  function buildFailureSummaries(results) {
    return results
      .filter((r) => !r.ok)
      .map((r) => ({ conversationId: Number(r.conversationId) || 0, error: String(r.error || "unknown error") }));
  }

  function buildAlreadyRunningError() {
    const error = new Error("sync already in progress");
    error.code = "sync_already_running";
    return error;
  }

  function parseHttpStatus(error) {
    const explicit = error && error.status != null ? Number(error.status) : NaN;
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const message = error && error.message ? String(error.message) : String(error || "");
    const match = message.match(/\bHTTP\s+(\d{3})\b/i);
    return match ? Number(match[1]) : 0;
  }

  function parseNotionErrorCode(error) {
    const explicit = String(error && error.code ? error.code : "").trim();
    if (explicit) return explicit.toLowerCase();
    const message = error && error.message ? String(error.message) : String(error || "");
    const codeMatch = message.match(/"code"\s*:\s*"([^"]+)"/i);
    return codeMatch ? String(codeMatch[1] || "").trim().toLowerCase() : "";
  }

  function parseNotionErrorMessage(error) {
    const message = error && error.message ? String(error.message) : String(error || "");
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

  function formatRetryHint(error) {
    const retryAfterMs = error && error.retryAfterMs != null ? Number(error.retryAfterMs) : 0;
    if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return "";
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return ` Retry in about ${seconds}s.`;
  }

  function normalizeNotionSyncError(error) {
    const rawMessage = error && error.message ? String(error.message) : String(error || "unknown error");
    if (!rawMessage) return "unknown error";
    if (!rawMessage.toLowerCase().includes("notion api failed:")) return rawMessage;

    const status = parseHttpStatus(error);
    const code = parseNotionErrorCode(error);
    const notionMessage = parseNotionErrorMessage(error).replace(/^notion api failed:\s*/i, "").trim();
    const lowerMessage = notionMessage.toLowerCase();

    if (code === "validation_error") {
      if (lowerMessage.includes("rich_text.length should be") || lowerMessage.includes("rich_text.length")) {
        return "Notion rejected one content block because it contained too many rich text fragments. The content needs to be split into smaller blocks.";
      }
      return `Notion validation failed: ${notionMessage}`;
    }

    if (status === 401) {
      return "Notion authorization expired. Please reconnect Notion and try again.";
    }

    if (status === 403) {
      return "Notion denied access to the target page or database. Please confirm the integration still has permission.";
    }

    if (status === 404 || code === "object_not_found") {
      if (lowerMessage.includes("database")) {
        return "The target Notion database no longer exists or is no longer accessible. Please reselect the parent page and retry.";
      }
      if (lowerMessage.includes("page")) {
        return "The target Notion page no longer exists or is no longer accessible. Please retry after reconnecting Notion or rebuilding the page.";
      }
      return "The target Notion object was not found. Please reconnect Notion or reselect the parent page and retry.";
    }

    if (status === 429 || code === "rate_limited") {
      return `Notion rate limited this sync.${formatRetryHint(error)}`.trim();
    }

    if (status >= 500) {
      return "Notion service is temporarily unavailable. Please retry later.";
    }

    return notionMessage || rawMessage;
  }

  function toCurrentConversationTitle(convo, id) {
    const title = convo && convo.title ? String(convo.title).trim() : "";
    if (title) return title;
    return `Conversation #${Number(id) || "?"}`;
  }

  function readRichText(items) {
    const list = Array.isArray(items) ? items : [];
    return list
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        if (item.plain_text != null) return String(item.plain_text);
        if (item.text && item.text.content != null) return String(item.text.content);
        return "";
      })
      .join("");
  }

  function normalizePagePropertyValue(property) {
    const prop = property && typeof property === "object" ? property : {};
    if (Array.isArray(prop.title)) return readRichText(prop.title);
    if (Array.isArray(prop.rich_text)) return readRichText(prop.rich_text);
    if (Array.isArray(prop.multi_select)) {
      return prop.multi_select
        .map((item) => String(item && item.name ? item.name : "").trim())
        .filter(Boolean)
        .sort()
        .join("|");
    }
    if (prop.date && typeof prop.date === "object") return String(prop.date.start || "");
    if (prop.url != null) return String(prop.url || "");
    return JSON.stringify(prop);
  }

  function pagePropertiesNeedUpdate(page, desiredProperties) {
    const pageProperties = page && page.properties && typeof page.properties === "object" ? page.properties : {};
    const desired = desiredProperties && typeof desiredProperties === "object" ? desiredProperties : {};
    for (const [key, value] of Object.entries(desired)) {
      if (!Object.prototype.hasOwnProperty.call(pageProperties, key)) return true;
      if (normalizePagePropertyValue(pageProperties[key]) !== normalizePagePropertyValue(value)) return true;
    }
    return false;
  }

  function normalizeJob(job) {
    if (!job || typeof job !== "object") return null;
    const perConversation = toPerConversationSnapshot(Array.isArray(job.perConversation) ? job.perConversation : []);
    const okCount = Number(job.okCount);
    const failCount = Number(job.failCount);
    return {
      ...job,
      provider: SYNC_PROVIDER,
      status: job.status === "finished" ? "done" : String(job.status || "done"),
      startedAt: Number(job.startedAt) || 0,
      updatedAt: Number(job.updatedAt) || Date.now(),
      finishedAt: job.finishedAt == null ? null : Number(job.finishedAt) || null,
      conversationIds: Array.isArray(job.conversationIds)
        ? job.conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
        : [],
      okCount: Number.isFinite(okCount) ? okCount : perConversation.filter((r) => r.ok).length,
      failCount: Number.isFinite(failCount) ? failCount : perConversation.filter((r) => !r.ok).length,
      perConversation,
    };
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
    const res = await storageGet(['notion_parent_page_id']);
    return String((res as any)?.notion_parent_page_id || '');
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
    try {
      await storageRemove([key]);
      return true;
    } catch (_e) {
      return false;
    }
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
    if (!notionJobStore || typeof notionJobStore.getJob !== "function") {
      throw new Error("notion sync job store missing");
    }
    const job = normalizeJob(await notionJobStore.getJob());
    return { provider: SYNC_PROVIDER, job, instanceId };
  }

  async function clearSyncJobStatus(input) {
    const instanceId = input && input.instanceId != null ? String(input.instanceId) : '';
    if (!notionJobStore || typeof notionJobStore.setJob !== "function") {
      throw new Error("notion sync job store missing");
    }
    await notionJobStore.setJob(null);
    return { provider: SYNC_PROVIDER, job: null, instanceId };
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
    if (notionJobStore.isRunningJob(existingJob)) throw buildAlreadyRunningError();

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
    const dbIdPromiseByKindId = new Map();
    const recoveredMissingDbByStorageKey = new Set();
    const dbRecoveryPromiseByStorageKey = new Map();

    async function ensureDbForKind(kind) {
      const existing = dbIdByKindId.get(kind.id);
      if (existing) return String(existing);
      const pending = dbIdPromiseByKindId.get(kind.id);
      if (pending) return pending;
      const spec = kind && kind.notion && kind.notion.dbSpec ? kind.notion.dbSpec : null;
      if (!spec) throw new Error(`missing dbSpec for kind ${kind && kind.id ? kind.id : "?"}`);
      const dbPromise = (async () => {
        const db = await notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId, dbSpec: spec });
        const dbId = db && db.databaseId ? String(db.databaseId) : "";
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

    async function recoverDbForStorageKey(kind, dbSpec) {
      const storageKey = String(dbSpec && dbSpec.storageKey ? dbSpec.storageKey : "");
      const pending = dbRecoveryPromiseByStorageKey.get(storageKey);
      if (pending) return pending;
      const recoveryPromise = (async () => {
        await clearCachedDatabaseId(notionDbManager, storageKey);
        const rebuiltDb = await notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId, dbSpec });
        const rebuiltDbId = rebuiltDb && rebuiltDb.databaseId ? String(rebuiltDb.databaseId) : "";
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

    const resultSlots = ids.map(() => null);
    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const jobStartedAt = Date.now();
    let runningJobWriteChain = Promise.resolve(true);

    function currentResults() {
      return resultSlots.filter(Boolean);
    }

    function setResultAt(index, result) {
      resultSlots[index] = result;
      return result;
    }

    async function writeRunningJob(partial = {}) {
      runningJobWriteChain = runningJobWriteChain
        .catch(() => true)
        .then(async () => {
          const results = currentResults();
          await notionJobStore.setJob({
            id: jobId,
            provider: SYNC_PROVIDER,
            instanceId,
            status: "running",
            startedAt: jobStartedAt,
            updatedAt: Date.now(),
            finishedAt: null,
            conversationIds: ids,
            okCount: results.filter((r) => r.ok).length,
            failCount: results.filter((r) => !r.ok).length,
            perConversation: toPerConversationSnapshot(results),
            ...partial
          });
          return true;
        });
      await runningJobWriteChain;
    }

    await writeRunningJob({
      currentConversationId: ids[0] || undefined,
      currentStage: ids.length ? "Preparing queue" : ""
    });

    async function processConversation(id, index) {
      const trace = createConversationTrace(id);
      await writeRunningJob({
        currentConversationId: id,
        currentConversationTitle: `Conversation #${id}`,
        currentStage: "Loading conversation"
      });

      try {
        trace.mark("load conversation");
        // eslint-disable-next-line no-await-in-loop
        const mapped = await (storage.getSyncMappingByConversation ? storage.getSyncMappingByConversation(id) : Promise.resolve(null));
        const convo = mapped && mapped.conversation ? mapped.conversation : null;
        const mapping = mapped && mapped.mapping ? mapped.mapping : null;
        await writeRunningJob({
          currentConversationId: id,
          currentConversationTitle: toCurrentConversationTitle(convo, id),
          currentStage: "Preparing sync"
        });
        if (!convo) {
          setResultAt(index, { conversationId: id, ok: false, error: "conversation not found" });
          return;
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

        await writeRunningJob({
          currentConversationId: id,
          currentConversationTitle: toCurrentConversationTitle(convo, id),
          currentStage: "Ensuring database"
        });

        trace.mark("ensure database");
        let dbId = await ensureDbForKind(kind);

        // eslint-disable-next-line no-await-in-loop
        const messages = await storage.getMessagesByConversationId(id);
        const cursor = extractCursor(mapping);

        let pageId = "";
        if (mapping && mapping.notionPageId) pageId = String(mapping.notionPageId || "");
        if (!pageId && convo.notionPageId) pageId = String(convo.notionPageId || "");

        let pageUsable = false;
        let existingPage = null;
        if (pageId) {
          await writeRunningJob({
            currentConversationId: id,
            currentConversationTitle: toCurrentConversationTitle(convo, id),
            currentStage: "Checking destination page"
          });
          trace.mark("check destination page");
          try {
            // eslint-disable-next-line no-await-in-loop
            const page = await notionSyncService.getPage(token.accessToken, pageId);
            existingPage = page;
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
          await writeRunningJob({
            currentConversationId: id,
            currentConversationTitle: toCurrentConversationTitle(convo, id),
            currentStage: "Creating destination page"
          });
          trace.mark("create destination page");
          try {
            // eslint-disable-next-line no-await-in-loop
            created = await notionSyncService.createPageInDatabase(token.accessToken, {
              databaseId: dbId,
              properties: pageSpec.buildCreateProperties(convo),
              capturedAt: convo.lastCapturedAt
            });
          } catch (createErr) {
            const shouldRecoverDb = isMissingDatabaseError(createErr);
            if (!shouldRecoverDb) throw createErr;
            const recoveredStorageKey = String(dbSpec.storageKey || "");
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Rebuilding database"
            });
            trace.mark("rebuild database");
            // Rebuild once per storage key and share the recovery across concurrent conversations.
            // eslint-disable-next-line no-await-in-loop
            dbId = recoveredMissingDbByStorageKey.has(recoveredStorageKey) && dbIdByKindId.get(kind.id)
              ? String(dbIdByKindId.get(kind.id) || "")
              : await recoverDbForStorageKey(kind, dbSpec);
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Creating destination page"
            });
            trace.mark("create destination page");
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
          await writeRunningJob({
            currentConversationId: id,
            currentConversationTitle: toCurrentConversationTitle(convo, id),
            currentStage: "Uploading message blocks"
          });
          trace.mark("build blocks");
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: messages
          });
          if (blocks.length) {
            trace.mark("append children");
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Saving sync cursor"
            });
            trace.mark("save cursor");
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          setResultAt(index, { conversationId: id, ok: true, notionPageId: pageId, mode: "created", appended: messages.length });
          trace.flush({ mode: "created", ok: true, blockCount: blocks.length });
          return;
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
          await writeRunningJob({
            currentConversationId: id,
            currentConversationTitle: toCurrentConversationTitle(convo, id),
            currentStage: "Rebuilding destination page"
          });
          trace.mark("rebuild page properties");
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.updatePageProperties(token.accessToken, {
            pageId,
            properties: pageSpec.buildUpdateProperties(convo)
          });
          trace.mark("clear page children");
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.clearPageChildren(token.accessToken, pageId);
          trace.mark("build blocks");
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: messages
          });
          if (blocks.length) {
            trace.mark("append children");
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Saving sync cursor"
            });
            trace.mark("save cursor");
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          setResultAt(index, { conversationId: id, ok: true, notionPageId: pageId, mode: "rebuilt", appended: messages.length });
          trace.flush({ mode: "rebuilt", ok: true, blockCount: blocks.length });
        } else if (inc.newMessages && inc.newMessages.length) {
          await writeRunningJob({
            currentConversationId: id,
            currentConversationTitle: toCurrentConversationTitle(convo, id),
            currentStage: "Appending new messages"
          });
          trace.mark("update page properties");
          // eslint-disable-next-line no-await-in-loop
          await notionSyncService.updatePageProperties(token.accessToken, {
            pageId,
            properties: pageSpec.buildUpdateProperties(convo)
          });
          trace.mark("build blocks");
          // eslint-disable-next-line no-await-in-loop
          const blocks = await buildBlocksForSync({
            notionSyncService,
            accessToken: token.accessToken,
            source: convo.source,
            messagesList: inc.newMessages
          });
          if (blocks.length) {
            trace.mark("append children");
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.appendChildren(token.accessToken, pageId, blocks);
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Saving sync cursor"
            });
            trace.mark("save cursor");
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          setResultAt(index, { conversationId: id, ok: true, notionPageId: pageId, mode: "appended", appended: inc.newMessages.length });
          trace.flush({ mode: "appended", ok: true, blockCount: blocks.length });
        } else {
          const desiredProperties = pageSpec.buildUpdateProperties(convo);
          const needsPropertyUpdate = pagePropertiesNeedUpdate(existingPage, desiredProperties);
          if (needsPropertyUpdate) {
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Updating page properties"
            });
            trace.mark("update page properties");
            // eslint-disable-next-line no-await-in-loop
            await notionSyncService.updatePageProperties(token.accessToken, {
              pageId,
              properties: desiredProperties
            });
          }
          if (storage.setSyncCursor) {
            await writeRunningJob({
              currentConversationId: id,
              currentConversationTitle: toCurrentConversationTitle(convo, id),
              currentStage: "Saving sync cursor"
            });
          }
          const nextCursor = lastMessageCursor(messages);
          if (storage.setSyncCursor) {
            trace.mark("save cursor");
            // eslint-disable-next-line no-await-in-loop
            await storage.setSyncCursor(id, nextCursor);
          }
          setResultAt(index, {
            conversationId: id,
            ok: true,
            notionPageId: pageId,
            mode: needsPropertyUpdate ? "updated_properties" : "no_changes",
            appended: 0
          });
          trace.flush({ mode: needsPropertyUpdate ? "updated_properties" : "no_changes", ok: true, blockCount: 0 });
        }
      } catch (e) {
        const normalizedError = normalizeNotionSyncError(e);
        setResultAt(index, { conversationId: id, ok: false, error: normalizedError });
        trace.flush({ mode: "failed", ok: false, error: normalizedError });
      }

      try {
        await writeRunningJob({
          currentConversationId: id,
          currentConversationTitle: undefined,
          currentStage: "Finishing current item"
        });
      } catch (_e) {
        // ignore
      }

    }

    const queue = ids.map((id, index) => ({ id, index }));
    let cursorIndex = 0;
    const workerCount = Math.max(1, Math.min(SYNC_CONVERSATION_CONCURRENCY, queue.length));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      for (;;) {
        const next = queue[cursorIndex];
        cursorIndex += 1;
        if (!next) return;
        await processConversation(next.id, next.index);
      }
    }));

    const results = currentResults();
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const failures = buildFailureSummaries(results);
    await notionJobStore.setJob({
      id: jobId,
      provider: SYNC_PROVIDER,
      instanceId,
      status: "done",
      startedAt: jobStartedAt,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      conversationIds: ids,
      currentConversationId: undefined,
      currentConversationTitle: undefined,
      currentStage: undefined,
      okCount,
      failCount,
      perConversation: toPerConversationSnapshot(results)
    });
    return { provider: SYNC_PROVIDER, results, okCount, failCount, failures, jobId, instanceId };
  }

  return {
    clearSyncJobStatus,
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

export async function clearSyncJobStatus(input: { instanceId: string }) {
  return defaultOrchestrator.clearSyncJobStatus(input as any);
}

export async function syncConversations(input: { conversationIds?: unknown[]; instanceId: string }) {
  return defaultOrchestrator.syncConversations(input as any);
}

export default defaultOrchestrator;

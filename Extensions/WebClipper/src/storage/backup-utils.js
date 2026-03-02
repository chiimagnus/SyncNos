(function () {
  const NS = require("../runtime-context.js");
  const conversationKinds = NS.conversationKinds;

  const BACKUP_SCHEMA_VERSION = 1;
  const BACKUP_ZIP_SCHEMA_VERSION = 2;

  const STORAGE_ALLOWLIST_BASE = Object.freeze([
    "notion_oauth_client_id",
    "notion_parent_page_id",
    "popup_active_tab",
    "popup_source_filter_key",
    "notion_ai_preferred_model_index"
  ]);

  function getNotionDbStorageKeys() {
    if (conversationKinds && typeof conversationKinds.getNotionStorageKeys === "function") {
      try {
        const keys = conversationKinds.getNotionStorageKeys();
        if (Array.isArray(keys) && keys.length) return keys.map((k) => String(k || "").trim()).filter(Boolean);
      } catch (_e) {
        // ignore
      }
    }
    // Fallback (load-order safety).
    return ["notion_db_id_syncnos_ai_chats", "notion_db_id_syncnos_web_articles"];
  }

  const STORAGE_ALLOWLIST = Object.freeze(Array.from(new Set([...STORAGE_ALLOWLIST_BASE, ...getNotionDbStorageKeys()])));

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function isFinitePositiveInt(v) {
    return Number.isFinite(v) && v > 0 && Math.floor(v) === v;
  }

  function uniqueConversationKey(conversation) {
    const source = conversation && conversation.source ? String(conversation.source) : "";
    const conversationKey = conversation && conversation.conversationKey ? String(conversation.conversationKey) : "";
    if (!source || !conversationKey) return "";
    return `${source}||${conversationKey}`;
  }

  function pickStringPreferExisting(existing, incoming) {
    const a = existing == null ? "" : String(existing);
    if (isNonEmptyString(a)) return a.trim();
    const b = incoming == null ? "" : String(incoming);
    return isNonEmptyString(b) ? b.trim() : "";
  }

  function pickStringPreferIncoming(existing, incoming) {
    const b = incoming == null ? "" : String(incoming);
    if (isNonEmptyString(b)) return b.trim();
    const a = existing == null ? "" : String(existing);
    return isNonEmptyString(a) ? a.trim() : "";
  }

  function mergeWarningFlags(existing, incoming) {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(incoming) ? incoming : [];
    const set = new Set();
    for (const x of a) {
      if (isNonEmptyString(x)) set.add(String(x).trim());
    }
    for (const x of b) {
      if (isNonEmptyString(x)) set.add(String(x).trim());
    }
    return Array.from(set);
  }

  function mergeConversationRecord(existing, incoming) {
    const a = existing && typeof existing === "object" ? existing : {};
    const b = incoming && typeof incoming === "object" ? incoming : {};

    const next = { ...a };
    next.sourceType = pickStringPreferExisting(a.sourceType, b.sourceType) || "chat";
    next.source = pickStringPreferExisting(a.source, b.source);
    next.conversationKey = pickStringPreferExisting(a.conversationKey, b.conversationKey);

    next.title = pickStringPreferExisting(a.title, b.title);
    next.url = pickStringPreferExisting(a.url, b.url);
    next.author = pickStringPreferExisting(a.author, b.author);
    next.publishedAt = pickStringPreferExisting(a.publishedAt, b.publishedAt);
    next.description = pickStringPreferExisting(a.description, b.description);
    next.warningFlags = mergeWarningFlags(a.warningFlags, b.warningFlags);

    // notionPageId: never overwrite a non-empty local mapping.
    next.notionPageId = pickStringPreferExisting(a.notionPageId, b.notionPageId);

    const aCaptured = Number(a.lastCapturedAt) || 0;
    const bCaptured = Number(b.lastCapturedAt) || 0;
    next.lastCapturedAt = Math.max(aCaptured, bCaptured, 0);

    return next;
  }

  function shouldPreferIncomingMessage(existing, incoming) {
    const a = existing && typeof existing === "object" ? existing : {};
    const b = incoming && typeof incoming === "object" ? incoming : {};
    const aUpdated = Number(a.updatedAt) || 0;
    const bUpdated = Number(b.updatedAt) || 0;
    if (bUpdated && bUpdated > aUpdated) return true;

    const aMd = a.contentMarkdown && String(a.contentMarkdown).trim() ? String(a.contentMarkdown) : "";
    const bMd = b.contentMarkdown && String(b.contentMarkdown).trim() ? String(b.contentMarkdown) : "";
    if (!aMd && bMd) return true;
    return false;
  }

  function mergeMessageRecord(existing, incoming) {
    const a = existing && typeof existing === "object" ? existing : {};
    const b = incoming && typeof incoming === "object" ? incoming : {};

    const preferIncoming = shouldPreferIncomingMessage(a, b);
    const base = preferIncoming ? { ...a, ...b } : { ...b, ...a };

    const next = { ...base };
    next.role = pickStringPreferExisting(base.role, "assistant") || "assistant";
    next.contentText = String(next.contentText || "");
    next.contentMarkdown = String(next.contentMarkdown || "");

    const aUpdated = Number(a.updatedAt) || 0;
    const bUpdated = Number(b.updatedAt) || 0;
    const maxUpdated = Math.max(aUpdated, bUpdated, 0);
    next.updatedAt = maxUpdated || Date.now();

    const aSeq = Number(a.sequence);
    const bSeq = Number(b.sequence);
    if (Number.isFinite(bSeq)) next.sequence = bSeq;
    else if (Number.isFinite(aSeq)) next.sequence = aSeq;
    else next.sequence = 0;

    return next;
  }

  function mergeSyncMappingRecord(existing, incoming) {
    const a = existing && typeof existing === "object" ? existing : {};
    const b = incoming && typeof incoming === "object" ? incoming : {};

    const next = { ...a };
    next.source = pickStringPreferExisting(a.source, b.source);
    next.conversationKey = pickStringPreferExisting(a.conversationKey, b.conversationKey);

    // notionPageId: only fill when missing locally.
    next.notionPageId = pickStringPreferExisting(a.notionPageId, b.notionPageId);

    // cursor: prefer existing local value; only fill when missing locally.
    next.lastSyncedMessageKey = pickStringPreferExisting(a.lastSyncedMessageKey, b.lastSyncedMessageKey);
    const aSeq = Number(a.lastSyncedSequence);
    const bSeq = Number(b.lastSyncedSequence);
    if (Number.isFinite(aSeq)) next.lastSyncedSequence = aSeq;
    else if (Number.isFinite(bSeq)) next.lastSyncedSequence = bSeq;

    const aAt = Number(a.lastSyncedAt);
    const bAt = Number(b.lastSyncedAt);
    if (Number.isFinite(aAt)) next.lastSyncedAt = aAt;
    else if (Number.isFinite(bAt)) next.lastSyncedAt = bAt;

    const aUpdated = Number(a.updatedAt) || 0;
    const bUpdated = Number(b.updatedAt) || 0;
    next.updatedAt = Math.max(aUpdated, bUpdated, 0);

    return next;
  }

  function filterStorageForBackup(storageLocal) {
    const input = storageLocal && typeof storageLocal === "object" ? storageLocal : {};
    const out = {};
    for (const key of STORAGE_ALLOWLIST) {
      if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
    }
    return out;
  }

  function validateBackupDocument(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Backup is not an object" };
    if (Number(doc.schemaVersion) !== BACKUP_SCHEMA_VERSION) return { ok: false, error: "Unsupported backup schemaVersion" };
    if (!doc.stores || typeof doc.stores !== "object") return { ok: false, error: "Missing stores" };
    const stores = doc.stores;
    for (const name of ["conversations", "messages", "sync_mappings"]) {
      if (!Array.isArray(stores[name])) return { ok: false, error: `Invalid store: ${name}` };
    }
    const storageLocal = doc.storageLocal;
    if (storageLocal != null && typeof storageLocal !== "object") return { ok: false, error: "Invalid storageLocal" };

    // Basic sanity checks for conversation uniqueness hints.
    const seen = new Set();
    for (const c of stores.conversations) {
      const uk = uniqueConversationKey(c);
      if (!uk) continue;
      if (seen.has(uk)) return { ok: false, error: "Duplicate conversation key in backup" };
      seen.add(uk);
    }

    // Message keys must be present to be importable.
    for (const m of stores.messages) {
      if (!m || !isNonEmptyString(m.messageKey)) return { ok: false, error: "Backup contains messages without messageKey" };
      if (!isFinitePositiveInt(Number(m.conversationId))) return { ok: false, error: "Backup contains messages without valid conversationId" };
    }

    return { ok: true, error: "" };
  }

  function isSafeZipPath(path) {
    const raw = String(path || "").trim();
    if (!raw) return false;
    if (raw.includes("\0")) return false;
    if (raw.startsWith("/") || raw.startsWith("\\")) return false;
    if (raw.includes("\\")) return false;
    if (/(^|\/)\.\.(\/|$)/.test(raw)) return false;
    return true;
  }

  function validateBackupManifest(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Manifest is not an object" };
    if (Number(doc.backupSchemaVersion) !== BACKUP_ZIP_SCHEMA_VERSION) {
      return { ok: false, error: "Unsupported backupSchemaVersion" };
    }
    if (!isNonEmptyString(doc.exportedAt)) return { ok: false, error: "Missing exportedAt" };
    if (!doc.db || typeof doc.db !== "object") return { ok: false, error: "Missing db" };
    if (!isNonEmptyString(doc.db.name)) return { ok: false, error: "Missing db.name" };
    if (!Number.isFinite(Number(doc.db.version))) return { ok: false, error: "Missing db.version" };

    if (!doc.counts || typeof doc.counts !== "object") return { ok: false, error: "Missing counts" };
    for (const k of ["conversations", "messages", "sync_mappings"]) {
      if (!Number.isFinite(Number(doc.counts[k])) || Number(doc.counts[k]) < 0) {
        return { ok: false, error: `Invalid counts.${k}` };
      }
    }

    const config = doc.config;
    if (!config || typeof config !== "object") return { ok: false, error: "Missing config" };
    const storageLocalPath = config.storageLocalPath;
    if (!isNonEmptyString(storageLocalPath) || !isSafeZipPath(storageLocalPath)) {
      return { ok: false, error: "Invalid config.storageLocalPath" };
    }
    if (!String(storageLocalPath).endsWith(".json")) return { ok: false, error: "Invalid config.storageLocalPath extension" };

    const index = doc.index;
    if (!index || typeof index !== "object") return { ok: false, error: "Missing index" };
    const conversationsCsvPath = index.conversationsCsvPath;
    if (!isNonEmptyString(conversationsCsvPath) || !isSafeZipPath(conversationsCsvPath)) {
      return { ok: false, error: "Invalid index.conversationsCsvPath" };
    }
    if (!String(conversationsCsvPath).endsWith(".csv")) return { ok: false, error: "Invalid index.conversationsCsvPath extension" };

    if (!Array.isArray(doc.sources)) return { ok: false, error: "Missing sources" };
    const seenFiles = new Set();
    for (const group of doc.sources) {
      if (!group || typeof group !== "object") return { ok: false, error: "Invalid sources item" };
      if (!isNonEmptyString(group.source)) return { ok: false, error: "Invalid sources[].source" };
      const files = Array.isArray(group.files) ? group.files : null;
      if (!files) return { ok: false, error: "Invalid sources[].files" };
      const expectedCount = Number(group.conversationCount);
      if (!Number.isFinite(expectedCount) || expectedCount < 0) return { ok: false, error: "Invalid sources[].conversationCount" };
      if (expectedCount !== files.length) return { ok: false, error: "sources[].conversationCount mismatch" };
      for (const filePath of files) {
        const p = String(filePath || "").trim();
        if (!p || !isSafeZipPath(p)) return { ok: false, error: "Invalid sources file path" };
        if (!p.startsWith("sources/")) return { ok: false, error: "Invalid sources file prefix" };
        if (!p.endsWith(".json")) return { ok: false, error: "Invalid sources file extension" };
        if (seenFiles.has(p)) return { ok: false, error: "Duplicate sources file path" };
        seenFiles.add(p);
      }
    }

    return { ok: true, error: "" };
  }

  function validateConversationBundle(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Bundle is not an object" };
    if (Number(doc.schemaVersion) !== 1) return { ok: false, error: "Unsupported bundle schemaVersion" };
    if (!doc.conversation || typeof doc.conversation !== "object") return { ok: false, error: "Missing conversation" };
    const conversation = doc.conversation;
    const source = conversation.source ? String(conversation.source) : "";
    const conversationKey = conversation.conversationKey ? String(conversation.conversationKey) : "";
    if (!isNonEmptyString(source) || !isNonEmptyString(conversationKey)) {
      return { ok: false, error: "Missing conversation.source or conversation.conversationKey" };
    }

    const messages = Array.isArray(doc.messages) ? doc.messages : null;
    if (!messages) return { ok: false, error: "Missing messages" };
    for (const m of messages) {
      if (!m || typeof m !== "object") return { ok: false, error: "Invalid message item" };
      if (!isNonEmptyString(m.messageKey)) return { ok: false, error: "Message missing messageKey" };
    }

    if (doc.syncMapping != null) {
      if (!doc.syncMapping || typeof doc.syncMapping !== "object") return { ok: false, error: "Invalid syncMapping" };
      const mappingSource = doc.syncMapping.source ? String(doc.syncMapping.source) : "";
      const mappingKey = doc.syncMapping.conversationKey ? String(doc.syncMapping.conversationKey) : "";
      if (!isNonEmptyString(mappingSource) || !isNonEmptyString(mappingKey)) {
        return { ok: false, error: "syncMapping missing source or conversationKey" };
      }
      if (mappingSource !== source || mappingKey !== conversationKey) {
        return { ok: false, error: "syncMapping does not match conversation" };
      }
    }

    return { ok: true, error: "" };
  }

  function validateStorageLocalDocument(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Storage backup is not an object" };
    if (Number(doc.schemaVersion) !== 1) return { ok: false, error: "Unsupported storage schemaVersion" };
    if (doc.storageLocal != null && typeof doc.storageLocal !== "object") return { ok: false, error: "Invalid storageLocal" };
    return { ok: true, error: "" };
  }

  const api = {
    BACKUP_SCHEMA_VERSION,
    BACKUP_ZIP_SCHEMA_VERSION,
    STORAGE_ALLOWLIST,
    uniqueConversationKey,
    mergeConversationRecord,
    mergeMessageRecord,
    mergeSyncMappingRecord,
    filterStorageForBackup,
    validateBackupDocument,
    validateBackupManifest,
    validateConversationBundle,
    validateStorageLocalDocument
  };
  NS.backupUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

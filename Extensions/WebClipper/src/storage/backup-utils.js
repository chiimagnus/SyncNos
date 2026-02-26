(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const BACKUP_SCHEMA_VERSION = 1;

  const STORAGE_ALLOWLIST = Object.freeze([
    "notion_oauth_client_id",
    "notion_parent_page_id",
    "notion_db_id_syncnos_ai_chats",
    "notion_db_id_syncnos_web_articles",
    "popup_active_tab"
  ]);

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

  const api = {
    BACKUP_SCHEMA_VERSION,
    STORAGE_ALLOWLIST,
    uniqueConversationKey,
    mergeConversationRecord,
    mergeMessageRecord,
    mergeSyncMappingRecord,
    filterStorageForBackup,
    validateBackupDocument
  };
  NS.backupUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

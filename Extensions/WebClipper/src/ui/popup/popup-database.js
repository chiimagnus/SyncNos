/* global chrome, IDBKeyRange */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const schema = NS.storageSchema;
  const backupUtils = NS.backupUtils;
  if (!core || !schema || !backupUtils) return;

  const { els, storageGet, storageSet, downloadBlob, flashOk, disableImageDrag } = core;

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
    });
  }

  function tx(db, storeNames, mode) {
    const t = db.transaction(storeNames, mode);
    return { t, stores: storeNames.reduce((acc, n) => ((acc[n] = t.objectStore(n)), acc), {}) };
  }

  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error || new Error("transaction failed"));
      t.onabort = () => reject(t.error || new Error("transaction aborted"));
    });
  }

  function setStatus(text) {
    if (!els.databaseBackupStatus) return;
    els.databaseBackupStatus.textContent = String(text || "");
  }

  function setBusy(busy) {
    const on = !!busy;
    if (els.btnDatabaseExport) els.btnDatabaseExport.disabled = on;
    if (els.databaseImportFile) els.databaseImportFile.disabled = on;
    if (els.btnDatabaseImport) els.btnDatabaseImport.disabled = on || !getSelectedFile();
  }

  async function exportDatabaseBackup() {
    setBusy(true);
    setStatus("Exporting…");
    try {
      const db = await schema.openDb();
      const { t, stores } = tx(db, ["conversations", "messages", "sync_mappings"], "readonly");
      const conversations = await reqToPromise(stores.conversations.getAll());
      const messages = await reqToPromise(stores.messages.getAll());
      const syncMappings = await reqToPromise(stores.sync_mappings.getAll());
      await txDone(t);

      const rawStorage = await storageGet(backupUtils.STORAGE_ALLOWLIST);
      const storageLocal = backupUtils.filterStorageForBackup(rawStorage);

      const payload = {
        schemaVersion: backupUtils.BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        db: { name: schema.DB_NAME, version: schema.DB_VERSION },
        stores: {
          conversations: conversations || [],
          messages: messages || [],
          sync_mappings: syncMappings || []
        },
        storageLocal
      };

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `webclipper-db-backup-${stamp}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      downloadBlob({ blob, filename, saveAs: true });
      flashOk(els.btnDatabaseExport);
      setStatus("Exported");
    } catch (e) {
      setStatus("Error");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function getSelectedFile() {
    const el = els.databaseImportFile;
    if (!el || !el.files || !el.files.length) return null;
    return el.files[0] || null;
  }

  async function importDatabaseBackupMerge(doc) {
    const validation = backupUtils.validateBackupDocument(doc);
    if (!validation.ok) throw new Error(validation.error || "Invalid backup file.");

    setBusy(true);
    setStatus("Importing…");

    const stats = {
      conversationsAdded: 0,
      conversationsUpdated: 0,
      messagesAdded: 0,
      messagesUpdated: 0,
      messagesSkipped: 0,
      mappingsAdded: 0,
      mappingsUpdated: 0,
      settingsApplied: 0
    };

    try {
      const stores = doc.stores || {};
      const backupConversations = Array.isArray(stores.conversations) ? stores.conversations : [];
      const backupMessages = Array.isArray(stores.messages) ? stores.messages : [];
      const backupMappings = Array.isArray(stores.sync_mappings) ? stores.sync_mappings : [];

      const backupConvoIdToUnique = new Map();
      for (const c of backupConversations) {
        if (!c) continue;
        const uk = backupUtils.uniqueConversationKey(c);
        if (!uk) continue;
        const id = Number(c.id);
        if (Number.isFinite(id) && id > 0) backupConvoIdToUnique.set(id, uk);
      }

      const db = await schema.openDb();

      // 1) Upsert conversations by (source, conversationKey).
      const uniqueToLocalId = new Map();
      {
        const { t, stores: s } = tx(db, ["conversations"], "readwrite");
        const idx = s.conversations.index("by_source_conversationKey");

        for (const incoming of backupConversations) {
          if (!incoming) continue;
          const source = incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) continue;

          // eslint-disable-next-line no-await-in-loop
          const existing = await reqToPromise(idx.get([source, conversationKey]));
          const merged = backupUtils.mergeConversationRecord(existing, incoming);

          if (existing && existing.id) {
            merged.id = existing.id;
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.conversations.put(merged));
            stats.conversationsUpdated += 1;
            uniqueToLocalId.set(`${source}||${conversationKey}`, existing.id);
          } else {
            // eslint-disable-next-line no-await-in-loop
            const id = await reqToPromise(s.conversations.add(merged));
            stats.conversationsAdded += 1;
            uniqueToLocalId.set(`${source}||${conversationKey}`, id);
          }
        }

        await txDone(t);
      }

      // 2) Upsert messages by (localConversationId, messageKey).
      {
        const { t, stores: s } = tx(db, ["messages"], "readwrite");
        const idx = s.messages.index("by_conversationId_messageKey");

        for (const incoming of backupMessages) {
          if (!incoming) continue;
          const backupConversationId = Number(incoming.conversationId);
          const messageKey = incoming.messageKey ? String(incoming.messageKey) : "";
          if (!Number.isFinite(backupConversationId) || backupConversationId <= 0 || !messageKey) {
            stats.messagesSkipped += 1;
            continue;
          }
          const uk = backupConvoIdToUnique.get(backupConversationId) || "";
          const localConversationId = uk ? uniqueToLocalId.get(uk) : null;
          if (!localConversationId) {
            stats.messagesSkipped += 1;
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const existing = await reqToPromise(idx.get([localConversationId, messageKey]));
          const base = { ...incoming, conversationId: localConversationId, messageKey };
          const merged = backupUtils.mergeMessageRecord(existing, base);
          merged.conversationId = localConversationId;
          merged.messageKey = messageKey;

          if (existing && existing.id) {
            merged.id = existing.id;
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.messages.put(merged));
            stats.messagesUpdated += 1;
          } else {
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.messages.add(merged));
            stats.messagesAdded += 1;
          }
        }

        await txDone(t);
      }

      // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId.
      {
        const { t, stores: s } = tx(db, ["sync_mappings", "conversations"], "readwrite");
        const idx = s.sync_mappings.index("by_source_conversationKey");
        const convoIdx = s.conversations.index("by_source_conversationKey");

        for (const incoming of backupMappings) {
          if (!incoming) continue;
          const source = incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) continue;

          // eslint-disable-next-line no-await-in-loop
          const existing = await reqToPromise(idx.get([source, conversationKey]));
          const merged = backupUtils.mergeSyncMappingRecord(existing, incoming);

          if (existing && existing.id) {
            merged.id = existing.id;
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.sync_mappings.put(merged));
            stats.mappingsUpdated += 1;
          } else {
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.sync_mappings.add(merged));
            stats.mappingsAdded += 1;
          }

          const notionPageId = merged.notionPageId ? String(merged.notionPageId) : "";
          if (notionPageId) {
            // eslint-disable-next-line no-await-in-loop
            const convo = await reqToPromise(convoIdx.get([source, conversationKey]));
            if (convo && convo.id && (!convo.notionPageId || !String(convo.notionPageId).trim())) {
              convo.notionPageId = notionPageId;
              // eslint-disable-next-line no-await-in-loop
              await reqToPromise(s.conversations.put(convo));
            }
          }
        }

        await txDone(t);
      }

      // 4) Apply non-sensitive chrome.storage.local settings (merge-only).
      const filtered = backupUtils.filterStorageForBackup(doc.storageLocal || {});
      const keys = Object.keys(filtered);
      if (keys.length) {
        await storageSet(filtered);
        stats.settingsApplied = keys.length;
      }

      setStatus("Imported");
      flashOk(els.btnDatabaseImport);
      return stats;
    } catch (e) {
      setStatus("Error");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function safeExport() {
    try {
      await exportDatabaseBackup();
    } catch (e) {
      alert((e && e.message) || "Export failed.");
    }
  }

  async function safeImport() {
    const file = getSelectedFile();
    if (!file) return;

    let doc;
    try {
      const text = await file.text();
      doc = JSON.parse(text);
    } catch (_e) {
      alert("Invalid JSON file.");
      return;
    }

    const ok = confirm("Import will MERGE the backup into your current database.\n\nContinue?");
    if (!ok) return;

    try {
      const stats = await importDatabaseBackupMerge(doc);
      alert(
        "Import finished.\n\n"
        + `Conversations: +${stats.conversationsAdded} / updated ${stats.conversationsUpdated}\n`
        + `Messages: +${stats.messagesAdded} / updated ${stats.messagesUpdated} / skipped ${stats.messagesSkipped}\n`
        + `Mappings: +${stats.mappingsAdded} / updated ${stats.mappingsUpdated}\n`
        + `Settings applied: ${stats.settingsApplied}\n`
      );
    } catch (e) {
      alert((e && e.message) || "Import failed.");
    }
  }

  function updateImportButtonState() {
    const file = getSelectedFile();
    if (els.btnDatabaseImport) els.btnDatabaseImport.disabled = !file;
    if (file) setStatus(`Selected: ${file.name}`);
    else setStatus("Ready");
  }

  function bindEvents() {
    if (els.btnDatabaseExport) els.btnDatabaseExport.addEventListener("click", () => safeExport());
    if (els.btnDatabaseImport) els.btnDatabaseImport.addEventListener("click", () => safeImport());
    if (els.databaseImportFile) {
      els.databaseImportFile.addEventListener("change", () => updateImportButtonState());
    }
  }

  function init() {
    disableImageDrag(els.viewSettings);
    updateImportButtonState();
    bindEvents();
  }

  NS.popupDatabase = {
    init
  };
})();

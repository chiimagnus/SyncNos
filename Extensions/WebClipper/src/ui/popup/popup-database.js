/* global chrome, IDBKeyRange */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const schema = NS.storageSchema;
  const backupUtils = NS.backupUtils;
  if (!core || !schema || !backupUtils) return;

  const { els, storageGet, storageSet, downloadBlob, flashOk, disableImageDrag } = core;

  const uiState = {
    busy: false,
    importTimer: null,
    exportTimer: null
  };

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

  function setImportButtonLabel(text) {
    if (!els.btnDatabaseImport) return;
    els.btnDatabaseImport.textContent = String(text || "Import");
  }

  function setExportButtonLabel(text) {
    if (!els.btnDatabaseExport) return;
    els.btnDatabaseExport.textContent = String(text || "Export");
  }

  function setBusy(busy) {
    const on = !!busy;
    uiState.busy = on;
    if (els.btnDatabaseExport) els.btnDatabaseExport.disabled = on;
    if (els.databaseImportFile) els.databaseImportFile.disabled = on;
    if (els.btnDatabaseImport) els.btnDatabaseImport.disabled = on;
  }

  function clearImportTimers() {
    if (uiState.importTimer) clearTimeout(uiState.importTimer);
    uiState.importTimer = null;
  }

  function clearExportTimers() {
    if (uiState.exportTimer) clearTimeout(uiState.exportTimer);
    uiState.exportTimer = null;
  }

  function resetImportUiDelayed(text, delayMs) {
    clearImportTimers();
    uiState.importTimer = setTimeout(() => {
      setImportButtonLabel("Import");
      setStatus("Ready");
      clearImportTimers();
    }, Number.isFinite(delayMs) ? delayMs : 1500);
    setImportButtonLabel(text);
  }

  function resetExportUiDelayed(text, delayMs) {
    clearExportTimers();
    uiState.exportTimer = setTimeout(() => {
      setExportButtonLabel("Export");
      setStatus("Ready");
      clearExportTimers();
    }, Number.isFinite(delayMs) ? delayMs : 1200);
    setExportButtonLabel(text);
  }

  async function exportDatabaseBackup() {
    setBusy(true);
    setStatus("Exporting…");
    setExportButtonLabel("Exporting…");
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
      resetExportUiDelayed("Exported ✓", 1300);
    } catch (e) {
      setStatus("Error");
      setExportButtonLabel("Export failed");
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

  function clearSelectedFile() {
    if (!els.databaseImportFile) return;
    try {
      els.databaseImportFile.value = "";
    } catch (_e) {
      // ignore
    }
  }

  function formatProgress({ done, total, stage }) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeDone = Math.min(safeTotal || 0, Math.max(0, Number(done) || 0));
    const pct = safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0;
    const labelStage = stage ? ` ${stage}` : "";
    return { pct, text: `Importing… ${pct}% (${safeDone}/${safeTotal})${labelStage}`.trim() };
  }

  async function importDatabaseBackupMerge(doc, onProgress) {
    const validation = backupUtils.validateBackupDocument(doc);
    if (!validation.ok) throw new Error(validation.error || "Invalid backup file.");

    setBusy(true);
    setStatus("Importing…");
    setImportButtonLabel("Importing… 0%");

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

      const filteredSettings = backupUtils.filterStorageForBackup(doc.storageLocal || {});
      const settingsKeys = Object.keys(filteredSettings);

      const totalWork = backupConversations.length + backupMessages.length + backupMappings.length + settingsKeys.length;
      const progress = { done: 0, total: totalWork, stage: "" };
      const report = () => {
        if (typeof onProgress !== "function") return;
        onProgress({ ...progress });
      };
      const bump = (n, stage) => {
        progress.done += Number(n) || 0;
        if (stage) progress.stage = stage;
        report();
      };
      report();

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

        progress.stage = "Conversations";
        report();
        for (let i = 0; i < backupConversations.length; i += 1) {
          const incoming = backupConversations[i];
          if (!incoming) {
            bump(1, "Conversations");
            continue;
          }
          const source = incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) {
            bump(1, "Conversations");
            continue;
          }

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

          bump(1, "Conversations");
        }

        await txDone(t);
      }

      // 2) Upsert messages by (localConversationId, messageKey).
      {
        const { t, stores: s } = tx(db, ["messages"], "readwrite");
        const idx = s.messages.index("by_conversationId_messageKey");

        progress.stage = "Messages";
        report();
        for (let i = 0; i < backupMessages.length; i += 1) {
          const incoming = backupMessages[i];
          if (!incoming) {
            bump(1, "Messages");
            continue;
          }
          const backupConversationId = Number(incoming.conversationId);
          const messageKey = incoming.messageKey ? String(incoming.messageKey) : "";
          if (!Number.isFinite(backupConversationId) || backupConversationId <= 0 || !messageKey) {
            stats.messagesSkipped += 1;
            bump(1, "Messages");
            continue;
          }
          const uk = backupConvoIdToUnique.get(backupConversationId) || "";
          const localConversationId = uk ? uniqueToLocalId.get(uk) : null;
          if (!localConversationId) {
            stats.messagesSkipped += 1;
            bump(1, "Messages");
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

          if (i % 25 === 0) report();
          bump(1, "Messages");
        }

        await txDone(t);
      }

      // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId.
      {
        const { t, stores: s } = tx(db, ["sync_mappings", "conversations"], "readwrite");
        const idx = s.sync_mappings.index("by_source_conversationKey");
        const convoIdx = s.conversations.index("by_source_conversationKey");

        progress.stage = "Mappings";
        report();
        for (let i = 0; i < backupMappings.length; i += 1) {
          const incoming = backupMappings[i];
          if (!incoming) {
            bump(1, "Mappings");
            continue;
          }
          const source = incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) {
            bump(1, "Mappings");
            continue;
          }

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

          bump(1, "Mappings");
        }

        await txDone(t);
      }

      // 4) Apply non-sensitive chrome.storage.local settings (merge-only).
      progress.stage = "Settings";
      report();
      if (settingsKeys.length) {
        await storageSet(filteredSettings);
        stats.settingsApplied = settingsKeys.length;
        bump(settingsKeys.length, "Settings");
      }

      setStatus("Imported");
      flashOk(els.btnDatabaseImport);
      setImportButtonLabel("Imported ✓");
      return stats;
    } catch (e) {
      setStatus("Error");
      setImportButtonLabel("Import failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function safeExport() {
    try {
      await exportDatabaseBackup();
    } catch (e) {
      resetExportUiDelayed("Export failed", 1600);
    }
  }

  async function importFromFile(file) {
    if (!file) return;
    if (uiState.busy) return;

    clearImportTimers();
    setStatus(`Importing: ${file.name}`);

    let doc;
    try {
      const text = await file.text();
      doc = JSON.parse(text);
    } catch (_e) {
      setStatus("Error");
      resetImportUiDelayed("Invalid file", 1800);
      clearSelectedFile();
      return;
    }

    try {
      await importDatabaseBackupMerge(doc, (p) => {
        const view = formatProgress(p || {});
        setImportButtonLabel(view.text);
      });
      resetImportUiDelayed("Imported ✓", 1600);
    } catch (_e) {
      setStatus("Error");
      resetImportUiDelayed("Import failed", 2000);
    } finally {
      clearSelectedFile();
    }
  }

  function bindEvents() {
    if (els.btnDatabaseExport) els.btnDatabaseExport.addEventListener("click", () => safeExport());
    if (els.btnDatabaseImport) {
      els.btnDatabaseImport.addEventListener("click", () => {
        if (uiState.busy) return;
        if (!els.databaseImportFile) return;
        try {
          els.databaseImportFile.click();
        } catch (_e) {
          // ignore
        }
      });
    }
    if (els.databaseImportFile) {
      els.databaseImportFile.addEventListener("change", () => {
        if (uiState.busy) return;
        const file = getSelectedFile();
        if (!file) return;
        importFromFile(file).catch(() => {});
      });
    }
  }

  function init() {
    disableImageDrag(els.viewSettings);
    setBusy(false);
    setStatus("Ready");
    setImportButtonLabel("Import");
    setExportButtonLabel("Export");
    bindEvents();
  }

  NS.popupDatabase = {
    init
  };
})();

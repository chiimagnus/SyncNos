/* global chrome, IDBKeyRange */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const list = NS.popupList;
  const schema = NS.storageSchema;
  const backupUtils = NS.backupUtils;
  const zipUtils = NS.zipUtils;
  if (!core || !schema || !backupUtils) return;

  const { els, storageGet, storageSet, downloadBlob, flashOk, disableImageDrag, createZipBlob } = core;

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

  function sanitizeZipPathPart(input, fallback) {
    const text = String(input || "").trim();
    if (!text) return fallback;
    const cleaned = text
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
    return cleaned;
  }

  function csvCell(raw) {
    const text = raw == null ? "" : String(raw);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
    return text;
  }

  function stripLocalConversation(conversation) {
    const c = conversation && typeof conversation === "object" ? { ...conversation } : {};
    delete c.id;
    return c;
  }

  function stripLocalMessage(message) {
    const m = message && typeof message === "object" ? { ...message } : {};
    delete m.id;
    delete m.conversationId;
    return m;
  }

  function stripLocalMapping(mapping) {
    const m = mapping && typeof mapping === "object" ? { ...mapping } : {};
    delete m.id;
    return m;
  }

  function compareMessages(a, b) {
    const aSeq = Number(a && a.sequence);
    const bSeq = Number(b && b.sequence);
    if (Number.isFinite(aSeq) && Number.isFinite(bSeq) && aSeq !== bSeq) return aSeq - bSeq;
    const aAt = Number(a && a.updatedAt) || 0;
    const bAt = Number(b && b.updatedAt) || 0;
    if (aAt !== bAt) return aAt - bAt;
    const aKey = a && a.messageKey ? String(a.messageKey) : "";
    const bKey = b && b.messageKey ? String(b.messageKey) : "";
    return aKey.localeCompare(bKey);
  }

  async function exportDatabaseBackupZipV2() {
    setBusy(true);
    setStatus("Exporting…");
    setExportButtonLabel("Exporting…");
    try {
      if (!createZipBlob || !zipUtils) throw new Error("ZIP module not available");
      const db = await schema.openDb();
      const { t, stores } = tx(db, ["conversations", "messages", "sync_mappings"], "readonly");
      const conversations = await reqToPromise(stores.conversations.getAll());
      const messages = await reqToPromise(stores.messages.getAll());
      const syncMappings = await reqToPromise(stores.sync_mappings.getAll());
      await txDone(t);

      const rawStorage = await storageGet(backupUtils.STORAGE_ALLOWLIST);
      const storageLocal = backupUtils.filterStorageForBackup(rawStorage);

      const exportedAt = new Date().toISOString();

      const allConversations = Array.isArray(conversations) ? conversations : [];
      const allMessages = Array.isArray(messages) ? messages : [];
      const allMappings = Array.isArray(syncMappings) ? syncMappings : [];

      const messagesByConversationId = new Map();
      for (const m of allMessages) {
        const cid = Number(m && m.conversationId);
        if (!Number.isFinite(cid) || cid <= 0) continue;
        const list = messagesByConversationId.get(cid) || [];
        list.push(m);
        messagesByConversationId.set(cid, list);
      }

      const mappingByUniqueKey = new Map();
      for (const m of allMappings) {
        if (!m || typeof m !== "object") continue;
        const uk = backupUtils.uniqueConversationKey(m);
        if (!uk) continue;
        const existing = mappingByUniqueKey.get(uk) || null;
        if (!existing) {
          mappingByUniqueKey.set(uk, m);
          continue;
        }
        const aUpdated = Number(existing.updatedAt) || 0;
        const bUpdated = Number(m.updatedAt) || 0;
        if (bUpdated > aUpdated) mappingByUniqueKey.set(uk, m);
      }

      const sources = new Map();
      for (const c of allConversations) {
        if (!c || typeof c !== "object") continue;
        const source = c.source ? String(c.source) : "";
        if (!source) continue;
        const list = sources.get(source) || [];
        list.push(c);
        sources.set(source, list);
      }

      const files = [];
      const manifestSources = [];

      const indexHeader = [
        "source",
        "conversationKey",
        "title",
        "url",
        "lastCapturedAt",
        "messageCount",
        "notionPageId",
        "hasNotionPageId",
        "filePath"
      ];
      const indexLines = [indexHeader.map(csvCell).join(",")];

      const usedPathsBySource = new Map();

      for (const [source, convos] of sources.entries()) {
        const safeSource = sanitizeZipPathPart(source.toLowerCase(), "unknown");
        const used = usedPathsBySource.get(safeSource) || new Set();
        usedPathsBySource.set(safeSource, used);

        const groupFiles = [];
        for (const c of convos) {
          const conversationKey = c && c.conversationKey ? String(c.conversationKey) : "";
          if (!conversationKey) continue;

          const safeKeyBase = sanitizeZipPathPart(conversationKey, "conversation");
          let safeKey = safeKeyBase;
          let suffix = 2;
          let entryPath = `sources/${safeSource}/${safeKey}.json`;
          while (used.has(entryPath)) {
            safeKey = `${safeKeyBase}-${suffix}`;
            entryPath = `sources/${safeSource}/${safeKey}.json`;
            suffix += 1;
          }
          used.add(entryPath);

          const cid = Number(c && c.id);
          const rawMsgs = Number.isFinite(cid) && cid > 0 ? (messagesByConversationId.get(cid) || []) : [];
          const msgs = rawMsgs.slice().sort(compareMessages).map(stripLocalMessage);

          const uk = backupUtils.uniqueConversationKey(c);
          const mapping = uk ? (mappingByUniqueKey.get(uk) || null) : null;
          const safeConversation = stripLocalConversation(c);
          const safeMapping = mapping ? stripLocalMapping(mapping) : null;

          const bundle = {
            schemaVersion: 1,
            conversation: safeConversation,
            messages: msgs,
            syncMapping: safeMapping
          };

          files.push({ name: entryPath, data: JSON.stringify(bundle, null, 2), lastModifiedAt: exportedAt });
          groupFiles.push(entryPath);

          const notionPageId = (safeMapping && safeMapping.notionPageId) ? String(safeMapping.notionPageId)
            : (safeConversation.notionPageId ? String(safeConversation.notionPageId) : "");
          const hasNotionPageId = notionPageId ? "true" : "false";

          indexLines.push([
            csvCell(source),
            csvCell(conversationKey),
            csvCell(safeConversation.title || ""),
            csvCell(safeConversation.url || ""),
            csvCell(safeConversation.lastCapturedAt || ""),
            csvCell(msgs.length),
            csvCell(notionPageId),
            csvCell(hasNotionPageId),
            csvCell(entryPath)
          ].join(","));
        }

        manifestSources.push({
          source,
          conversationCount: groupFiles.length,
          files: groupFiles
        });
      }

      const storageDoc = {
        schemaVersion: 1,
        storageLocal
      };
      files.push({ name: "config/storage-local.json", data: JSON.stringify(storageDoc, null, 2), lastModifiedAt: exportedAt });
      files.push({ name: "index/conversations.csv", data: indexLines.join("\n"), lastModifiedAt: exportedAt });

      const manifest = {
        backupSchemaVersion: backupUtils.BACKUP_ZIP_SCHEMA_VERSION,
        exportedAt,
        db: { name: schema.DB_NAME, version: schema.DB_VERSION },
        counts: {
          conversations: allConversations.length,
          messages: allMessages.length,
          sync_mappings: allMappings.length
        },
        config: { storageLocalPath: "config/storage-local.json" },
        index: { conversationsCsvPath: "index/conversations.csv" },
        sources: manifestSources
      };
      files.unshift({ name: "manifest.json", data: JSON.stringify(manifest, null, 2), lastModifiedAt: exportedAt });

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `webclipper-db-backup-${stamp}.zip`;
      const blob = await createZipBlob(files);
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

  function decodeUtf8(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    return new TextDecoder("utf-8").decode(arr);
  }

  function readJsonEntry(entries, name) {
    if (!entries || typeof entries.get !== "function") throw new Error("Invalid zip entries");
    const bytes = entries.get(name);
    if (!bytes) throw new Error(`Missing entry: ${name}`);
    const text = decodeUtf8(bytes);
    return JSON.parse(text);
  }

  async function isZipFile(file) {
    if (!file) return false;
    const name = file.name ? String(file.name).toLowerCase() : "";
    const type = file.type ? String(file.type).toLowerCase() : "";
    if (name.endsWith(".zip") || type.includes("zip")) return true;
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (head.length < 4) return false;
      return head[0] === 0x50 && head[1] === 0x4b && (
        (head[2] === 0x03 && head[3] === 0x04)
        || (head[2] === 0x05 && head[3] === 0x06)
        || (head[2] === 0x07 && head[3] === 0x08)
      );
    } catch (_e) {
      return false;
    }
  }

  async function importDatabaseBackupZipV2(entries, onProgress) {
    const manifest = readJsonEntry(entries, "manifest.json");
    const manifestValidation = backupUtils.validateBackupManifest(manifest);
    if (!manifestValidation.ok) throw new Error(manifestValidation.error || "Invalid manifest.json");

    const configPath = manifest && manifest.config ? String(manifest.config.storageLocalPath || "") : "";
    const configDoc = configPath ? readJsonEntry(entries, configPath) : null;
    if (!configDoc) throw new Error("Missing config/storage-local.json");
    const configValidation = backupUtils.validateStorageLocalDocument(configDoc);
    if (!configValidation.ok) throw new Error(configValidation.error || "Invalid storage-local.json");

    const filteredSettings = backupUtils.filterStorageForBackup(configDoc.storageLocal || {});
    const settingsKeys = Object.keys(filteredSettings);

    const convoFiles = [];
    const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
    for (const group of sources) {
      const files = group && Array.isArray(group.files) ? group.files : [];
      for (const p of files) convoFiles.push(String(p || "").trim());
    }

    const incomingConversations = [];
    const messagesByUniqueKey = new Map();
    const incomingMappings = [];
    const seenUnique = new Set();
    let totalMessages = 0;

    for (const filePath of convoFiles) {
      if (!filePath) continue;
      const bundle = readJsonEntry(entries, filePath);
      const bundleValidation = backupUtils.validateConversationBundle(bundle);
      if (!bundleValidation.ok) throw new Error(bundleValidation.error || `Invalid conversation bundle: ${filePath}`);

      const convo = bundle.conversation;
      const uk = backupUtils.uniqueConversationKey(convo);
      if (!uk) throw new Error(`Invalid conversation key: ${filePath}`);
      if (seenUnique.has(uk)) throw new Error("Duplicate conversation key in zip");
      seenUnique.add(uk);

      const msgs = Array.isArray(bundle.messages) ? bundle.messages : [];
      messagesByUniqueKey.set(uk, msgs);
      totalMessages += msgs.length;

      incomingConversations.push(convo);
      if (bundle.syncMapping) incomingMappings.push(bundle.syncMapping);
    }

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

    const progress = { done: 0, total: convoFiles.length + totalMessages + incomingMappings.length + settingsKeys.length, stage: "" };

    function report() {
      onProgress && onProgress({ ...progress });
    }

    function bump(delta, stage) {
      progress.done += delta;
      progress.stage = stage || progress.stage;
    }

    try {
      const db = await schema.openDb();

      // 1) Upsert conversations by (source, conversationKey).
      const uniqueToLocalId = new Map();
      {
        const { t, stores: s } = tx(db, ["conversations"], "readwrite");
        const idx = s.conversations.index("by_source_conversationKey");

        progress.stage = "Conversations";
        report();
        for (let i = 0; i < incomingConversations.length; i += 1) {
          const incoming = incomingConversations[i];
          const source = incoming && incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming && incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) {
            bump(1, "Conversations");
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const existing = await reqToPromise(idx.get([source, conversationKey]));
          const merged = backupUtils.mergeConversationRecord(existing, incoming);
          merged.source = source;
          merged.conversationKey = conversationKey;

          const uk = backupUtils.uniqueConversationKey(merged);
          if (existing && existing.id) {
            merged.id = existing.id;
            // eslint-disable-next-line no-await-in-loop
            await reqToPromise(s.conversations.put(merged));
            uniqueToLocalId.set(uk, Number(existing.id));
            stats.conversationsUpdated += 1;
          } else {
            // eslint-disable-next-line no-await-in-loop
            const id = await reqToPromise(s.conversations.add(merged));
            uniqueToLocalId.set(uk, Number(id));
            stats.conversationsAdded += 1;
          }

          if (i % 20 === 0) report();
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
        let i = 0;
        for (const [uk, messages] of messagesByUniqueKey.entries()) {
          const localConversationId = uniqueToLocalId.get(uk) || null;
          const list = Array.isArray(messages) ? messages : [];
          if (!localConversationId) {
            stats.messagesSkipped += list.length;
            bump(list.length, "Messages");
            continue;
          }
          for (const incoming of list) {
            const messageKey = incoming && incoming.messageKey ? String(incoming.messageKey) : "";
            if (!messageKey) {
              stats.messagesSkipped += 1;
              bump(1, "Messages");
              continue;
            }

            // eslint-disable-next-line no-await-in-loop
            const existing = await reqToPromise(idx.get([localConversationId, messageKey]));
            const base = { ...(incoming || {}), conversationId: localConversationId, messageKey };
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

            if (i % 40 === 0) report();
            i += 1;
            bump(1, "Messages");
          }
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
        for (let i = 0; i < incomingMappings.length; i += 1) {
          const incoming = incomingMappings[i];
          const source = incoming && incoming.source ? String(incoming.source) : "";
          const conversationKey = incoming && incoming.conversationKey ? String(incoming.conversationKey) : "";
          if (!source || !conversationKey) {
            bump(1, "Mappings");
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const existing = await reqToPromise(idx.get([source, conversationKey]));
          const merged = backupUtils.mergeSyncMappingRecord(existing, incoming);
          merged.source = source;
          merged.conversationKey = conversationKey;

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
      await exportDatabaseBackupZipV2();
    } catch (e) {
      resetExportUiDelayed("Export failed", 1600);
    }
  }

  async function importFromFile(file) {
    if (!file) return;
    if (uiState.busy) return;

    clearImportTimers();
    setStatus(`Importing: ${file.name}`);

    try {
      const asZip = await isZipFile(file);
      if (asZip) {
        if (!zipUtils || typeof zipUtils.extractZipEntries !== "function") throw new Error("ZIP module not available");
        const entries = await zipUtils.extractZipEntries(file);
        await importDatabaseBackupZipV2(entries, (p) => {
          const view = formatProgress(p || {});
          setImportButtonLabel(view.text);
        });
      } else {
        const text = await file.text();
        const doc = JSON.parse(text);
        await importDatabaseBackupMerge(doc, (p) => {
          const view = formatProgress(p || {});
          setImportButtonLabel(view.text);
        });
      }
      resetImportUiDelayed("Imported ✓", 1600);
      try {
        list && typeof list.refresh === "function" && list.refresh();
      } catch (_e) {
        // ignore
      }
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

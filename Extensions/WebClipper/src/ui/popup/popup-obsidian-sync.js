/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const core = NS.popupCore;
  if (!core) return;

  const { els, send, flashOk } = core;
  const contracts = NS.messageContracts || {};
  const obsidianTypes = contracts.OBSIDIAN_MESSAGE_TYPES || {
    GET_SETTINGS: "obsidianGetSettings",
    SAVE_SETTINGS: "obsidianSaveSettings",
    TEST_CONNECTION: "obsidianTestConnection"
  };

  const STATUS = Object.freeze({
    idle: "Idle",
    loading: "Loading…",
    saving: "Saving…",
    saved: "Saved",
    error: "Error (see console)"
  });

  const OBSIDIAN_SETUP_GUIDE_URL = "https://github.com/chiimagnus/SyncNos/blob/feat/.github/guide/obsidian/setup-guide.md";

  let suppressEvents = true;
  let busy = false;

  let saveTimer = 0;
  let saveInFlight = false;
  let savePending = false;

  let lastSaved = { apiBaseUrl: null, authHeaderName: null, chatFolder: null, articleFolder: null };

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function setStatus(text) {
    if (!els.obsidianSyncStatus) return;
    els.obsidianSyncStatus.textContent = String(text || "");
  }

  function setBusy(isBusy) {
    busy = !!isBusy;
    if (els.btnObsidianTestConnection) els.btnObsidianTestConnection.disabled = busy;
    if (els.obsidianApiBaseUrl) els.obsidianApiBaseUrl.disabled = busy;
    if (els.obsidianApiKey) els.obsidianApiKey.disabled = busy;
    if (els.obsidianAuthHeaderName) els.obsidianAuthHeaderName.disabled = busy;
    if (els.obsidianChatFolder) els.obsidianChatFolder.disabled = busy;
    if (els.obsidianArticleFolder) els.obsidianArticleFolder.disabled = busy;
  }

  function readUiPayload({ includeApiKey } = {}) {
    const apiBaseUrl = els.obsidianApiBaseUrl ? safeString(els.obsidianApiBaseUrl.value) : "";
    const authHeaderName = els.obsidianAuthHeaderName ? safeString(els.obsidianAuthHeaderName.value) : "";
    const chatFolder = els.obsidianChatFolder ? safeString(els.obsidianChatFolder.value) : "";
    const articleFolder = els.obsidianArticleFolder ? safeString(els.obsidianArticleFolder.value) : "";

    const shouldIncludeKey = includeApiKey === true;
    const apiKeyRaw = els.obsidianApiKey ? String(els.obsidianApiKey.value || "") : "";
    const apiKeyTrimmed = safeString(apiKeyRaw);
    const apiKey = shouldIncludeKey && apiKeyTrimmed ? apiKeyRaw : null;

    return { apiBaseUrl, authHeaderName, chatFolder, articleFolder, apiKey };
  }

  function applySettingsToUi(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    suppressEvents = true;
    try {
      if (els.obsidianApiBaseUrl) els.obsidianApiBaseUrl.value = s.apiBaseUrl ? String(s.apiBaseUrl) : "";
      if (els.obsidianAuthHeaderName) els.obsidianAuthHeaderName.value = s.authHeaderName ? String(s.authHeaderName) : "";
      if (els.obsidianChatFolder) els.obsidianChatFolder.value = s.chatFolder ? String(s.chatFolder) : "";
      if (els.obsidianArticleFolder) els.obsidianArticleFolder.value = s.articleFolder ? String(s.articleFolder) : "";
      if (els.obsidianApiKey) {
        els.obsidianApiKey.value = s.apiKey ? String(s.apiKey) : "";
        els.obsidianApiKey.placeholder = "";
      }
    } finally {
      suppressEvents = false;
    }
  }

  function snapshotFromSettings(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    return {
      apiBaseUrl: s.apiBaseUrl ? String(s.apiBaseUrl) : "",
      authHeaderName: s.authHeaderName ? String(s.authHeaderName) : "",
      chatFolder: s.chatFolder ? String(s.chatFolder) : "",
      articleFolder: s.articleFolder ? String(s.articleFolder) : ""
    };
  }

  function snapshotFromUi() {
    const p = readUiPayload({ includeApiKey: false });
    return {
      apiBaseUrl: p.apiBaseUrl ? String(p.apiBaseUrl) : "",
      authHeaderName: p.authHeaderName ? String(p.authHeaderName) : "",
      chatFolder: p.chatFolder ? String(p.chatFolder) : "",
      articleFolder: p.articleFolder ? String(p.articleFolder) : ""
    };
  }

  function snapshotsEqual(a, b) {
    const x = a && typeof a === "object" ? a : {};
    const y = b && typeof b === "object" ? b : {};
    return String(x.apiBaseUrl || "") === String(y.apiBaseUrl || "")
      && String(x.authHeaderName || "") === String(y.authHeaderName || "")
      && String(x.chatFolder || "") === String(y.chatFolder || "")
      && String(x.articleFolder || "") === String(y.articleFolder || "");
  }

  async function refreshSettings() {
    const res = await send(obsidianTypes.GET_SETTINGS);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to load Obsidian settings.");
    applySettingsToUi(res.data);
    lastSaved = snapshotFromSettings(res.data);
    return res.data;
  }

  async function saveSettings({ includeApiKey, applyUi } = {}) {
    const payload = readUiPayload({ includeApiKey: includeApiKey === true });
    const res = await send(obsidianTypes.SAVE_SETTINGS, payload);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to save Obsidian settings.");
    if (applyUi !== false) applySettingsToUi(res.data);
    lastSaved = snapshotFromSettings(res.data);
    return res.data;
  }

  function scheduleSave({ delayMs, includeApiKey, applyUi } = {}) {
    if (suppressEvents) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      runSave({ includeApiKey, applyUi });
    }, Number.isFinite(delayMs) ? delayMs : 450);
  }

  function runSave({ includeApiKey, applyUi } = {}) {
    if (suppressEvents) return;
    if (busy) {
      savePending = true;
      scheduleSave({ delayMs: 120, includeApiKey, applyUi });
      return;
    }
    if (saveInFlight) {
      savePending = true;
      return;
    }

    const keyToSave = includeApiKey === true && els.obsidianApiKey ? safeString(els.obsidianApiKey.value) : "";

    // If nothing meaningful changed, don't spam storage writes.
    const current = snapshotFromUi();
    const hasNonKeyChanges = !snapshotsEqual(current, lastSaved);
    if (!keyToSave && !hasNonKeyChanges) {
      setStatus(STATUS.idle);
      return;
    }

    saveInFlight = true;
    setStatus(STATUS.saving);
    saveSettings({ includeApiKey: includeApiKey === true, applyUi })
      .then(() => setStatus(STATUS.saved))
      .catch((e) => {
        try {
          console.warn("[ObsidianSettings] save failed", e);
        } catch (_e2) {
          // ignore
        }
        setStatus(STATUS.error);
      })
      .finally(() => {
        saveInFlight = false;
        if (savePending) {
          savePending = false;
          scheduleSave({ delayMs: 120 });
        }
      });
  }

  async function testConnection() {
    const res = await send(obsidianTypes.TEST_CONNECTION);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Test failed.");
    const data = res.data || {};
    if (!data.ok) {
      const msg = data.error && data.error.message ? String(data.error.message) : "Connection failed.";
      throw new Error(msg);
    }
    return data;
  }

  function bindEvents() {
    function onEnterSave(e) {
      if (!e || e.key !== "Enter") return;
      try { e.preventDefault(); } catch (_e2) {}
      runSave({ applyUi: true });
    }

    if (els.obsidianApiBaseUrl) {
      els.obsidianApiBaseUrl.addEventListener("blur", () => runSave({ applyUi: true }));
      els.obsidianApiBaseUrl.addEventListener("keydown", onEnterSave);
    }

    if (els.obsidianAuthHeaderName) {
      els.obsidianAuthHeaderName.addEventListener("blur", () => runSave({ applyUi: true }));
      els.obsidianAuthHeaderName.addEventListener("keydown", onEnterSave);
    }

    if (els.obsidianChatFolder) {
      els.obsidianChatFolder.addEventListener("blur", () => runSave({ applyUi: true }));
      els.obsidianChatFolder.addEventListener("keydown", onEnterSave);
    }

    if (els.obsidianArticleFolder) {
      els.obsidianArticleFolder.addEventListener("blur", () => runSave({ applyUi: true }));
      els.obsidianArticleFolder.addEventListener("keydown", onEnterSave);
    }

    if (els.obsidianApiKey) {
      // Only save API key when the user commits the value (Enter/blur).
      els.obsidianApiKey.addEventListener("blur", () => {
        const typed = els.obsidianApiKey ? safeString(els.obsidianApiKey.value) : "";
        if (!typed) return;
        runSave({ includeApiKey: true, applyUi: true });
      });
      els.obsidianApiKey.addEventListener("keydown", (e) => {
        if (!e || e.key !== "Enter") return;
        try { e.preventDefault(); } catch (_e2) {}
        runSave({ includeApiKey: true, applyUi: true });
      });
    }

    if (els.btnObsidianTestConnection) {
      els.btnObsidianTestConnection.addEventListener("click", () => {
        setBusy(true);
        setStatus("Testing…");

        // Flush pending changes first; include API key only if user typed one.
        const includeApiKey = !!(els.obsidianApiKey && safeString(els.obsidianApiKey.value));
        Promise.resolve()
          .then(() => saveSettings({ includeApiKey, applyUi: includeApiKey }))
          .then(() => testConnection())
          .then(() => {
            flashOk && flashOk(els.btnObsidianTestConnection);
            setStatus("Connected ✅");
          })
          .catch((e) => {
            setStatus("Failed");
            alert((e && e.message) || "Test failed.");
          })
          .finally(() => setBusy(false));
      });
    }

    if (els.obsidianSetupGuideLink) {
      els.obsidianSetupGuideLink.addEventListener("click", (e) => {
        try { e && e.preventDefault && e.preventDefault(); } catch (_e2) {}
        chrome.tabs.create({ url: OBSIDIAN_SETUP_GUIDE_URL });
      });
    }
  }

  function init() {
    bindEvents();
    setBusy(true);
    setStatus(STATUS.loading);
    refreshSettings()
      .then(() => setStatus(STATUS.idle))
      .catch((e) => {
        try {
          console.warn("[ObsidianSettings] init failed", e);
        } catch (_e2) {
          // ignore
        }
        setStatus(STATUS.error);
        alert((e && e.message) || "Failed to load settings.");
      })
      .finally(() => {
        suppressEvents = false;
        setBusy(false);
      });
  }

  NS.popupObsidianSync = { init, __test: { applySettingsToUi, readUiPayload, snapshotsEqual, snapshotFromUi } };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupObsidianSync;
})();

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
    dirty: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: "Error (see console)"
  });

  let suppressEvents = true;
  let busy = false;

  let saveTimer = 0;
  let saveInFlight = false;
  let savePending = false;
  let dirty = false;

  let lastSaved = { apiBaseUrl: null, authHeaderName: null };

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
  }

  function readUiPayload({ includeApiKey } = {}) {
    const apiBaseUrl = els.obsidianApiBaseUrl ? safeString(els.obsidianApiBaseUrl.value) : "";
    const authHeaderName = els.obsidianAuthHeaderName ? safeString(els.obsidianAuthHeaderName.value) : "";

    const shouldIncludeKey = includeApiKey === true;
    const apiKeyRaw = els.obsidianApiKey ? String(els.obsidianApiKey.value || "") : "";
    const apiKeyTrimmed = safeString(apiKeyRaw);
    const apiKey = shouldIncludeKey && apiKeyTrimmed ? apiKeyRaw : null;

    return { apiBaseUrl, authHeaderName, apiKey };
  }

  function applySettingsToUi(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    suppressEvents = true;
    try {
      if (els.obsidianApiBaseUrl) els.obsidianApiBaseUrl.value = s.apiBaseUrl ? String(s.apiBaseUrl) : "";
      if (els.obsidianAuthHeaderName) els.obsidianAuthHeaderName.value = s.authHeaderName ? String(s.authHeaderName) : "";
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
      authHeaderName: s.authHeaderName ? String(s.authHeaderName) : ""
    };
  }

  function snapshotFromUi() {
    const p = readUiPayload({ includeApiKey: false });
    return {
      apiBaseUrl: p.apiBaseUrl ? String(p.apiBaseUrl) : "",
      authHeaderName: p.authHeaderName ? String(p.authHeaderName) : ""
    };
  }

  function snapshotsEqual(a, b) {
    const x = a && typeof a === "object" ? a : {};
    const y = b && typeof b === "object" ? b : {};
    return String(x.apiBaseUrl || "") === String(y.apiBaseUrl || "")
      && String(x.authHeaderName || "") === String(y.authHeaderName || "");
  }

  async function refreshSettings() {
    const res = await send(obsidianTypes.GET_SETTINGS);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to load Obsidian settings.");
    applySettingsToUi(res.data);
    lastSaved = snapshotFromSettings(res.data);
    dirty = false;
    return res.data;
  }

  async function saveSettings({ includeApiKey, applyUi } = {}) {
    const payload = readUiPayload({ includeApiKey: includeApiKey === true });
    const res = await send(obsidianTypes.SAVE_SETTINGS, payload);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to save Obsidian settings.");
    if (applyUi !== false) applySettingsToUi(res.data);
    lastSaved = snapshotFromSettings(res.data);
    dirty = false;
    return res.data;
  }

  function scheduleSave({ delayMs, includeApiKey, applyUi } = {}) {
    if (suppressEvents) return;
    dirty = true;
    setStatus(STATUS.dirty);
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
    if (!keyToSave && (!dirty || snapshotsEqual(current, lastSaved))) {
      dirty = false;
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
    if (els.obsidianApiBaseUrl) {
      els.obsidianApiBaseUrl.addEventListener("input", () => scheduleSave());
      els.obsidianApiBaseUrl.addEventListener("blur", () => runSave({ applyUi: true }));
    }

    if (els.obsidianAuthHeaderName) {
      els.obsidianAuthHeaderName.addEventListener("input", () => scheduleSave());
      els.obsidianAuthHeaderName.addEventListener("blur", () => runSave({ applyUi: true }));
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

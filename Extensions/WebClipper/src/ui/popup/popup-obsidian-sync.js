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

  function setStatus(text) {
    if (!els.obsidianSyncStatus) return;
    els.obsidianSyncStatus.textContent = String(text || "");
  }

  function setBusy(busy) {
    const on = !!busy;
    if (els.btnObsidianSettingsSave) els.btnObsidianSettingsSave.disabled = on;
    if (els.btnObsidianTestConnection) els.btnObsidianTestConnection.disabled = on;
    if (els.obsidianSyncEnabled) els.obsidianSyncEnabled.disabled = on;
    if (els.obsidianApiBaseUrl) els.obsidianApiBaseUrl.disabled = on;
    if (els.obsidianApiKey) els.obsidianApiKey.disabled = on;
    if (els.obsidianAuthHeaderName) els.obsidianAuthHeaderName.disabled = on;
  }

  function readUiPayload() {
    const enabled = els.obsidianSyncEnabled ? Boolean(els.obsidianSyncEnabled.checked) : false;
    const apiBaseUrl = els.obsidianApiBaseUrl ? String(els.obsidianApiBaseUrl.value || "").trim() : "";
    const authHeaderName = els.obsidianAuthHeaderName ? String(els.obsidianAuthHeaderName.value || "").trim() : "";
    const apiKeyRaw = els.obsidianApiKey ? String(els.obsidianApiKey.value || "") : "";

    // Keep existing key unless user typed something new.
    const apiKey = apiKeyRaw.trim() ? apiKeyRaw : null;
    return { enabled, apiBaseUrl, authHeaderName, apiKey };
  }

  function applySettingsToUi(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    if (els.obsidianSyncEnabled) els.obsidianSyncEnabled.checked = !!s.enabled;
    if (els.obsidianApiBaseUrl) els.obsidianApiBaseUrl.value = s.apiBaseUrl ? String(s.apiBaseUrl) : "";
    if (els.obsidianAuthHeaderName) els.obsidianAuthHeaderName.value = s.authHeaderName ? String(s.authHeaderName) : "";
    if (els.obsidianApiKey) {
      // Never show plaintext key. Provide a placeholder when key exists.
      els.obsidianApiKey.value = "";
      const masked = s.apiKeyMasked ? String(s.apiKeyMasked) : "";
      els.obsidianApiKey.placeholder = masked || "";
    }
  }

  async function refreshSettings() {
    const res = await send(obsidianTypes.GET_SETTINGS);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to load Obsidian settings.");
    applySettingsToUi(res.data);
    return res.data;
  }

  async function saveSettings() {
    const payload = readUiPayload();
    const res = await send(obsidianTypes.SAVE_SETTINGS, payload);
    if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Failed to save Obsidian settings.");
    applySettingsToUi(res.data);
    return res.data;
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
    if (els.btnObsidianSettingsSave) {
      els.btnObsidianSettingsSave.addEventListener("click", () => {
        setBusy(true);
        setStatus("Saving…");
        saveSettings()
          .then(() => {
            flashOk && flashOk(els.btnObsidianSettingsSave);
            setStatus("Saved");
          })
          .catch((e) => {
            setStatus("Error");
            alert((e && e.message) || "Save failed.");
          })
          .finally(() => setBusy(false));
      });
    }

    if (els.btnObsidianTestConnection) {
      els.btnObsidianTestConnection.addEventListener("click", () => {
        setBusy(true);
        setStatus("Testing…");
        testConnection()
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
    setStatus("Loading…");
    refreshSettings()
      .then(() => setStatus("Idle"))
      .catch((e) => {
        setStatus("Error");
        alert((e && e.message) || "Failed to load settings.");
      })
      .finally(() => setBusy(false));
  }

  NS.popupObsidianSync = { init, __test: { applySettingsToUi, readUiPayload } };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupObsidianSync;
})();

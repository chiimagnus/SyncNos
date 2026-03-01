/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const STORAGE_KEYS = Object.freeze({
    enabled: "obsidian_sync_enabled",
    apiBaseUrl: "obsidian_api_base_url",
    apiKey: "obsidian_api_key",
    authHeaderName: "obsidian_api_auth_header_name",
  });

  const DEFAULTS = Object.freeze({
    enabled: false,
    apiBaseUrl: "http://127.0.0.1:27123",
    authHeaderName: "Authorization",
  });

  function safeString(v) {
    const s = String(v == null ? "" : v).trim();
    return s;
  }

  function normalizeBaseUrl(input) {
    const s = safeString(input);
    return s || DEFAULTS.apiBaseUrl;
  }

  function normalizeAuthHeaderName(input) {
    const s = safeString(input);
    return s || DEFAULTS.authHeaderName;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== "function") return resolve({});
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.set !== "function") return resolve(false);
      chrome.storage.local.set(obj || {}, () => resolve(true));
    });
  }

  async function getSettings() {
    const res = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.apiKey, STORAGE_KEYS.authHeaderName]);
    const enabled = res[STORAGE_KEYS.enabled];
    const apiBaseUrl = normalizeBaseUrl(res[STORAGE_KEYS.apiBaseUrl]);
    const apiKey = safeString(res[STORAGE_KEYS.apiKey]);
    const authHeaderName = normalizeAuthHeaderName(res[STORAGE_KEYS.authHeaderName]);

    return {
      enabled: enabled == null ? DEFAULTS.enabled : Boolean(enabled),
      apiBaseUrl,
      authHeaderName,
      apiKeyPresent: !!apiKey,
      // Do not expose the plaintext key back to the popup.
      apiKeyMasked: apiKey ? "********" : ""
    };
  }

  async function saveSettings({ enabled, apiBaseUrl, apiKey, authHeaderName } = {}) {
    const payload = {};
    if (enabled != null) payload[STORAGE_KEYS.enabled] = Boolean(enabled);
    if (apiBaseUrl != null) payload[STORAGE_KEYS.apiBaseUrl] = normalizeBaseUrl(apiBaseUrl);
    if (authHeaderName != null) payload[STORAGE_KEYS.authHeaderName] = normalizeAuthHeaderName(authHeaderName);
    // If apiKey is omitted (undefined/null), keep existing.
    if (apiKey != null) payload[STORAGE_KEYS.apiKey] = safeString(apiKey);

    await storageSet(payload);
    return getSettings();
  }

  NS.obsidianSettingsStore = {
    STORAGE_KEYS,
    DEFAULTS,
    getSettings,
    saveSettings
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianSettingsStore;
})();


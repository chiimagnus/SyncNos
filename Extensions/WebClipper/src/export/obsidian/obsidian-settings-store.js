/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const STORAGE_KEYS = Object.freeze({
    apiBaseUrl: "obsidian_api_base_url",
    apiKey: "obsidian_api_key",
    authHeaderName: "obsidian_api_auth_header_name",
    chatFolder: "obsidian_chat_folder",
    articleFolder: "obsidian_article_folder",
  });

  const DEFAULTS = Object.freeze({
    apiBaseUrl: "http://127.0.0.1:27123",
    authHeaderName: "Authorization",
    chatFolder: "SyncNos-AIChats",
    articleFolder: "SyncNos-WebArticles",
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

  function normalizeFolder(input, fallbackFolder) {
    const raw = safeString(input);
    const fallback = safeString(fallbackFolder);
    const s = raw || fallback;
    if (!s) return "";

    // Normalize to a safe, vault-relative folder path.
    const normalized = s
      .replace(/\\/g, "/")
      .split("/")
      .map((seg) => String(seg || "").trim())
      .filter((seg) => !!seg && seg !== "." && seg !== "..")
      .join("/");
    return normalized || fallback || "";
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
    const res = await storageGet([
      STORAGE_KEYS.apiBaseUrl,
      STORAGE_KEYS.apiKey,
      STORAGE_KEYS.authHeaderName,
      STORAGE_KEYS.chatFolder,
      STORAGE_KEYS.articleFolder
    ]);
    const apiBaseUrl = normalizeBaseUrl(res[STORAGE_KEYS.apiBaseUrl]);
    const apiKey = safeString(res[STORAGE_KEYS.apiKey]);
    const authHeaderName = normalizeAuthHeaderName(res[STORAGE_KEYS.authHeaderName]);
    const chatFolder = normalizeFolder(res[STORAGE_KEYS.chatFolder], DEFAULTS.chatFolder);
    const articleFolder = normalizeFolder(res[STORAGE_KEYS.articleFolder], DEFAULTS.articleFolder);

    return {
      apiBaseUrl,
      authHeaderName,
      // User requested plaintext display in the popup.
      apiKey,
      apiKeyPresent: !!apiKey,
      chatFolder,
      articleFolder,
      // Do not expose the plaintext key back to the popup.
      apiKeyMasked: apiKey ? "********************************" : ""
    };
  }

  async function getConnectionConfig() {
    const res = await storageGet([STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.apiKey, STORAGE_KEYS.authHeaderName]);
    return {
      apiBaseUrl: normalizeBaseUrl(res[STORAGE_KEYS.apiBaseUrl]),
      apiKey: safeString(res[STORAGE_KEYS.apiKey]),
      authHeaderName: normalizeAuthHeaderName(res[STORAGE_KEYS.authHeaderName])
    };
  }

  async function getPathConfig() {
    const res = await storageGet([STORAGE_KEYS.chatFolder, STORAGE_KEYS.articleFolder]);
    return {
      chatFolder: normalizeFolder(res[STORAGE_KEYS.chatFolder], DEFAULTS.chatFolder),
      articleFolder: normalizeFolder(res[STORAGE_KEYS.articleFolder], DEFAULTS.articleFolder),
      defaults: { chatFolder: DEFAULTS.chatFolder, articleFolder: DEFAULTS.articleFolder }
    };
  }

  async function saveSettings({ apiBaseUrl, apiKey, authHeaderName, chatFolder, articleFolder } = {}) {
    const payload = {};
    if (apiBaseUrl != null) payload[STORAGE_KEYS.apiBaseUrl] = normalizeBaseUrl(apiBaseUrl);
    if (authHeaderName != null) payload[STORAGE_KEYS.authHeaderName] = normalizeAuthHeaderName(authHeaderName);
    // If apiKey is omitted (undefined/null), keep existing.
    if (apiKey != null) payload[STORAGE_KEYS.apiKey] = safeString(apiKey);
    if (chatFolder != null) payload[STORAGE_KEYS.chatFolder] = normalizeFolder(chatFolder, DEFAULTS.chatFolder);
    if (articleFolder != null) payload[STORAGE_KEYS.articleFolder] = normalizeFolder(articleFolder, DEFAULTS.articleFolder);

    await storageSet(payload);
    return getSettings();
  }

  NS.obsidianSettingsStore = {
    STORAGE_KEYS,
    DEFAULTS,
    getSettings,
    getConnectionConfig,
    getPathConfig,
    saveSettings
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianSettingsStore;
})();

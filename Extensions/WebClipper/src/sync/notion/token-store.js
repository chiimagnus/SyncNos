/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const KEY = "notion_oauth_token_v1";

  function getToken() {
    return new Promise((resolve) => {
      if (!chrome || !chrome.storage || !chrome.storage.local) return resolve(null);
      chrome.storage.local.get([KEY], (res) => resolve((res && res[KEY]) || null));
    });
  }

  function setToken(token) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: token || null }, () => resolve(true));
    });
  }

  function clearToken() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([KEY], () => resolve(true));
    });
  }

  const api = { getToken, setToken, clearToken, KEY };
  NS.notionTokenStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


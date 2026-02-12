/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DEFAULTS = Object.freeze({
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    redirectUri: "https://chiimagnus.github.io/syncnos-oauth/callback",
    owner: "user",
    responseType: "code",
    scopes: [] // Notion's OAuth doesn't require scopes param in the standard flow; keep for future.
  });

  function getDefaults() {
    return { ...DEFAULTS };
  }

  function loadClientConfig() {
    return new Promise((resolve) => {
      if (!chrome || !chrome.storage || !chrome.storage.local) return resolve({ clientId: "", clientSecret: "" });
      chrome.storage.local.get(["notion_oauth_client_id", "notion_oauth_client_secret"], (res) => {
        resolve({
          clientId: (res && res.notion_oauth_client_id) || "",
          clientSecret: (res && res.notion_oauth_client_secret) || ""
        });
      });
    });
  }

  function saveClientConfig({ clientId, clientSecret }) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          notion_oauth_client_id: clientId || "",
          notion_oauth_client_secret: clientSecret || ""
        },
        () => resolve(true)
      );
    });
  }

  const api = { getDefaults, loadClientConfig, saveClientConfig };
  NS.notionOAuthConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


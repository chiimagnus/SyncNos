(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DEFAULTS = Object.freeze({
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenExchangeProxyUrl: "https://syncnos-notion-oauth.chiimagnus.workers.dev/notion/oauth/exchange",
    redirectUri: "https://chiimagnus.github.io/syncnos-oauth/callback",
    owner: "user",
    responseType: "code"
  });

  function getDefaults() {
    return { ...DEFAULTS };
  }

  const api = { getDefaults };
  NS.notionOAuthConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

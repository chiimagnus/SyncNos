(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function buildAuthorizeUrl({ clientId, redirectUri, state, owner, responseType }) {
    const base = "https://api.notion.com/v1/oauth/authorize";
    const url = new URL(base);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", responseType || "code");
    url.searchParams.set("owner", owner || "user");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  function parseCallbackUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const error = url.searchParams.get("error") || "";
      return { ok: !error && !!code, code, state, error };
    } catch (_e) {
      return { ok: false, code: "", state: "", error: "invalid_url" };
    }
  }

  const api = { buildAuthorizeUrl, parseCallbackUrl };
  NS.notionOAuthClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DEFAULT_NOTION_OAUTH_CLIENT_ID = "2a8d872b-594c-8060-9a2b-00377c27ec32";

  function ensureDefaultNotionOAuthClientId() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(["notion_oauth_client_id"], (res) => {
        const currentId = (res && res.notion_oauth_client_id) ? String(res.notion_oauth_client_id) : "";
        if (currentId) return;
        chrome.storage.local.set({ notion_oauth_client_id: DEFAULT_NOTION_OAUTH_CLIENT_ID });
      });
      chrome.storage.local.remove(["notion_oauth_client_secret"]);
    } catch (_e) {
      // ignore
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchWithTimeout(url, init, timeoutMs) {
    const ms = Number.isFinite(timeoutMs) ? timeoutMs : 12_000;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const merged = { ...(init || {}), signal: controller.signal };
      return await fetch(url, merged);
    } finally {
      clearTimeout(t);
    }
  }

  async function exchangeNotionCodeForToken({ code }) {
    const cfg = NS.notionOAuthConfig && NS.notionOAuthConfig.getDefaults ? NS.notionOAuthConfig.getDefaults() : null;
    if (!cfg) throw new Error("notion oauth config missing");
    const proxyUrl = cfg.tokenExchangeProxyUrl || "";
    if (!proxyUrl) throw new Error("token exchange proxy url not configured");

    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await fetchWithTimeout(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ code, redirectUri: cfg.redirectUri })
        }, 12_000);
        const text = await res.text();
        if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
        const json = JSON.parse(text);
        if (!json || !json.access_token) throw new Error("no access_token in response");
        return json;
      } catch (e) {
        lastErr = e;
        // Only retry for transient failures.
        const msg = String((e && e.message) || e || "");
        const transient = /aborted|timeout|network|fetch/i.test(msg);
        if (attempt >= 2 || !transient) break;
        await sleep(700);
      }
    }
    throw lastErr || new Error("token exchange failed");
  }

  function parseQueryFromUrl(url) {
    try {
      const u = new URL(url);
      return {
        code: u.searchParams.get("code") || "",
        state: u.searchParams.get("state") || "",
        error: u.searchParams.get("error") || ""
      };
    } catch (_e) {
      return { code: "", state: "", error: "invalid_url" };
    }
  }

  async function handleNotionCallbackNavigation(details) {
    const cfg = NS.notionOAuthConfig && NS.notionOAuthConfig.getDefaults ? NS.notionOAuthConfig.getDefaults() : null;
    if (!cfg) return;
    const redirectBase = cfg.redirectUri;
    if (!details || !details.url || !details.url.startsWith(redirectBase)) return;

    const { code, state, error } = parseQueryFromUrl(details.url);
    if (error) {
      chrome.storage.local.set({ notion_oauth_last_error: error });
      return;
    }
    if (!code || !state) return;

    chrome.storage.local.get(["notion_oauth_pending_state"], async (res) => {
      const pending = (res && res.notion_oauth_pending_state) || "";
      if (!pending || pending !== state) return;

      try {
        const tokenJson = await exchangeNotionCodeForToken({ code });
        const token = {
          accessToken: tokenJson.access_token,
          workspaceId: tokenJson.workspace && tokenJson.workspace.id ? tokenJson.workspace.id : "",
          workspaceName: tokenJson.workspace && tokenJson.workspace.name ? tokenJson.workspace.name : "",
          createdAt: Date.now()
        };
        await (NS.notionTokenStore && NS.notionTokenStore.setToken ? NS.notionTokenStore.setToken(token) : Promise.resolve());
        chrome.storage.local.remove(["notion_oauth_pending_state"]);
        chrome.storage.local.set({ notion_oauth_last_error: "" });
        if (details.tabId >= 0 && chrome.tabs && chrome.tabs.remove) {
          chrome.tabs.remove(details.tabId);
        }
      } catch (e) {
        chrome.storage.local.set({ notion_oauth_last_error: e && e.message ? e.message : String(e) });
      }
    });
  }

  function setupNotionOAuthNavigationListener() {
    if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
      chrome.webNavigation.onCommitted.addListener((details) => {
        handleNotionCallbackNavigation(details).catch(() => {});
      });
    }
  }

  NS.backgroundNotionOAuth = {
    ensureDefaultNotionOAuthClientId,
    setupNotionOAuthNavigationListener
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.backgroundNotionOAuth;
})();


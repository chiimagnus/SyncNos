/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, runtime, send, storageGet, storageSet, flashOk } = core;

  async function getNotionOAuthMeta() {
    const res = await storageGet(["notion_oauth_last_error", "notion_oauth_pending_state"]);
    return {
      lastError: (res && res.notion_oauth_last_error) ? String(res.notion_oauth_last_error) : "",
      pendingState: (res && res.notion_oauth_pending_state) ? String(res.notion_oauth_pending_state) : ""
    };
  }

  async function getNotionOAuthClientId() {
    const res = await storageGet(["notion_oauth_client_id"]);
    return (res && res.notion_oauth_client_id) ? String(res.notion_oauth_client_id).trim() : "";
  }

  async function getNotionAccessToken() {
    const status = await send("getNotionAuthStatus");
    if (!status || !status.ok || !status.data || !status.data.connected) return "";
    return status.data.token && status.data.token.accessToken ? status.data.token.accessToken : "";
  }

  async function ensureNotionApiLoaded() {
    if (globalThis.WebClipper && globalThis.WebClipper.notionApi) return globalThis.WebClipper.notionApi;
    const script = document.createElement("script");
    const url = runtime && typeof runtime.getURL === "function" ? runtime.getURL("src/sync/notion/notion-api.js") : "";
    if (!url) return null;
    script.src = url;
    document.documentElement.appendChild(script);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return globalThis.WebClipper && globalThis.WebClipper.notionApi ? globalThis.WebClipper.notionApi : null;
  }

  async function loadParentPages() {
    const accessToken = await getNotionAccessToken();
    if (!accessToken) {
      alert("Notion not connected.");
      return;
    }
    const api = await ensureNotionApiLoaded();
    if (!api) {
      alert("Notion API module not available.");
      return;
    }
    const result = await api.searchPages({ accessToken, query: "", pageSize: 50 });
    const pagesRaw = Array.isArray(result.results) ? result.results : [];
    const withoutDatabaseEntries = pagesRaw.filter((p) => !(p && p.parent && p.parent.type === "database_id"));
    const rootPages = withoutDatabaseEntries.filter((p) => p && p.parent && p.parent.type === "workspace");
    const pages = rootPages.length ? rootPages : withoutDatabaseEntries;

    if (!els.notionPages) return;
    els.notionPages.innerHTML = "";
    for (const page of pages) {
      const opt = document.createElement("option");
      opt.value = page.id;
      opt.textContent = api.getPageTitle(page);
      els.notionPages.appendChild(opt);
    }

    const saved = await storageGet(["notion_parent_page_id"]);
    if (saved && saved.notion_parent_page_id) {
      els.notionPages.value = saved.notion_parent_page_id;
    }
  }

  async function saveParentPage() {
    if (!els.notionPages) return;
    const id = els.notionPages.value;
    if (!id) return;
    await storageSet({ notion_parent_page_id: id });
  }

  function buildNotionAuthorizeUrl({ clientId, state }) {
    const redirectUri = "https://chiimagnus.github.io/syncnos-oauth/callback";
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  let notionConnectPollTimer = null;
  let notionParentPagesLoaded = false;

  function setNotionConnectBusy(busy) {
    if (!els.btnNotionConnect) return;
    els.btnNotionConnect.disabled = !!busy;
  }

  async function openNotionAuthorizeTab(url) {
    if (!url) return false;
    try {
      if (chrome && chrome.tabs && typeof chrome.tabs.create === "function") {
        await new Promise((resolve) => chrome.tabs.create({ url: String(url) }, () => resolve(true)));
        return true;
      }
    } catch (_e) {
      // ignore
    }
    try {
      window.open(String(url), "_blank", "noopener,noreferrer");
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function saveNotionReturnTarget() {
    try {
      if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== "function") return;
      const tab = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(Array.isArray(tabs) ? tabs[0] : null));
      });
      const tabId = tab && Number.isFinite(tab.id) ? tab.id : null;
      const windowId = tab && Number.isFinite(tab.windowId) ? tab.windowId : null;
      const payload = {};
      if (tabId != null) payload.notion_oauth_return_tab_id = tabId;
      if (windowId != null) payload.notion_oauth_return_window_id = windowId;
      if (Object.keys(payload).length) await storageSet(payload);
    } catch (_e) {
      // ignore
    }
  }

  function startNotionConnectPolling() {
    if (notionConnectPollTimer) clearInterval(notionConnectPollTimer);
    const startedAt = Date.now();
    notionConnectPollTimer = setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        stopNotionConnectPolling();
        return;
      }
      refreshNotionStatus().catch(() => {});
    }, 750);
  }

  function stopNotionConnectPolling() {
    if (!notionConnectPollTimer) return;
    clearInterval(notionConnectPollTimer);
    notionConnectPollTimer = null;
  }

  function setNotionParentControlsEnabled(enabled) {
    const on = !!enabled;
    if (els.btnNotionLoadPages) els.btnNotionLoadPages.disabled = !on;
    if (els.notionPages) els.notionPages.disabled = !on;
  }

  async function refreshNotionStatus() {
    const res = await send("getNotionAuthStatus");
    const meta = await getNotionOAuthMeta();
    if (!res || !res.ok || !res.data) {
      if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Not connected";
      if (els.btnNotionConnect) els.btnNotionConnect.textContent = "Connect";
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      stopNotionConnectPolling();
      notionParentPagesLoaded = false;
      if (els.notionPages) els.notionPages.innerHTML = "";
      return;
    }
    if (res.data.connected) {
      const workspaceName = (res.data.token && res.data.token.workspaceName) ? String(res.data.token.workspaceName).trim() : "";
      const showWorkspace = workspaceName && workspaceName.toLowerCase() !== "connected";
      if (els.notionStatusTitle) els.notionStatusTitle.textContent = showWorkspace ? `Connected ✅ (${workspaceName})` : "Connected ✅";
      if (els.btnNotionConnect) els.btnNotionConnect.textContent = "Disconnect";
      setNotionParentControlsEnabled(true);
      setNotionConnectBusy(false);
      stopNotionConnectPolling();

      if (!notionParentPagesLoaded) {
        notionParentPagesLoaded = true;
        loadParentPages().catch(() => {});
      }
    } else {
      if (meta && meta.lastError) {
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Error";
        if (!refreshNotionStatus.__lastAlert || refreshNotionStatus.__lastAlert !== meta.lastError) {
          refreshNotionStatus.__lastAlert = meta.lastError;
          alert(`Notion OAuth error: ${meta.lastError}`);
        }
      } else if (meta && meta.pendingState) {
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Waiting…";
      } else {
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Not connected";
      }
      if (els.btnNotionConnect) els.btnNotionConnect.textContent = "Connect";
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      notionParentPagesLoaded = false;
    }
  }

  function bindEvents() {
    if (els.btnNotionLoadPages) {
      els.btnNotionLoadPages.addEventListener("click", () => {
        loadParentPages()
          .then(() => flashOk(els.btnNotionLoadPages))
          .catch((e) => alert(e && e.message ? e.message : String(e)));
      });
    }

    if (els.notionPages) {
      els.notionPages.addEventListener("change", () => {
        saveParentPage().catch(() => {});
      });
    }

    if (els.btnNotionConnect) {
      els.btnNotionConnect.addEventListener("click", async () => {
        const status = await send("getNotionAuthStatus");
        if (status && status.ok && status.data && status.data.connected) {
          await send("notionDisconnect");
          await refreshNotionStatus();
          return;
        }

        const clientId = await getNotionOAuthClientId();
        if (!clientId) {
          alert("Notion OAuth client is not configured.");
          await refreshNotionStatus();
          return;
        }

        const state = `webclipper_${Math.random().toString(16).slice(2)}_${Date.now()}`;
        await storageSet({ notion_oauth_pending_state: state });
        await saveNotionReturnTarget();
        const url = buildNotionAuthorizeUrl({ clientId, state });
        setNotionConnectBusy(true);
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Connecting…";
        const opened = await openNotionAuthorizeTab(url);
        if (!opened) {
          setNotionConnectBusy(false);
          alert("Failed to open Notion OAuth tab. Please check your browser popup settings.");
          await refreshNotionStatus();
          return;
        }
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Authorize in Notion";
        startNotionConnectPolling();
      });
    }
  }

  function init() {
    bindEvents();
    refreshNotionStatus().catch(() => {});
  }

  NS.popupNotion = {
    init,
    refreshNotionStatus
  };
})();

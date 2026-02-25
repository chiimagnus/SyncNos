/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, send, storageGet, storageSet, flashOk, disableImageDrag, openHttpUrl } = core;
  const contracts = NS.messageContracts || {};
  const notionTypes = contracts.NOTION_MESSAGE_TYPES || {
    GET_AUTH_STATUS: "getNotionAuthStatus",
    DISCONNECT: "notionDisconnect"
  };

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
    const status = await send(notionTypes.GET_AUTH_STATUS);
    if (!status || !status.ok || !status.data || !status.data.connected) return "";
    return status.data.token && status.data.token.accessToken ? status.data.token.accessToken : "";
  }

  function setParentPagePlaceholder(text) {
    if (!els.notionPages) return;
    const option = document.createElement("option");
    option.value = "";
    option.disabled = true;
    option.selected = true;
    option.textContent = String(text || "No pages available.");
    els.notionPages.replaceChildren(option);
  }

  async function loadParentPages() {
    setParentPagesLoading(true);
    try {
      const accessToken = await getNotionAccessToken();
      if (!accessToken) {
        setParentPagePlaceholder("Connect Notion to load pages.");
        alert("Notion not connected.");
        return;
      }
      const api = globalThis.WebClipper && globalThis.WebClipper.notionApi ? globalThis.WebClipper.notionApi : null;
      if (!api) {
        setParentPagePlaceholder("Notion API is unavailable. Reload extension.");
        alert("Notion API module not available.");
        return;
      }
      const result = await api.searchPages({ accessToken, query: "", pageSize: 50 });
      const pagesRaw = Array.isArray(result.results) ? result.results : [];
      const pages = pagesRaw.filter((p) => !(p && (p.archived === true || p.in_trash === true)));

      if (!els.notionPages) return;
      if (!pages.length) {
        setParentPagePlaceholder("No accessible parent pages. Share one with SyncNos.");
        return;
      }

      els.notionPages.replaceChildren();
      for (const page of pages) {
        const opt = document.createElement("option");
        opt.value = page.id;
        opt.textContent = api.getPageTitle(page);
        els.notionPages.appendChild(opt);
      }

      const saved = await storageGet(["notion_parent_page_id"]);
      const savedId = (saved && saved.notion_parent_page_id) ? String(saved.notion_parent_page_id).trim() : "";
      const hasSavedOption = (() => {
        if (!savedId) return false;
        try {
          return Array.from(els.notionPages.options || []).some((o) => o && String(o.value) === savedId);
        } catch (_e) {
          return false;
        }
      })();

      if (hasSavedOption) {
        els.notionPages.value = savedId;
      }

      // Important: `notionSyncConversations` reads `notion_parent_page_id` from storage.
      // If the user never changes the dropdown (still on the first option), the value would
      // never be persisted, causing sync to fail with "missing parentPageId".
      const currentSelected = String(els.notionPages.value || "").trim();
      if (currentSelected && (!savedId || !hasSavedOption || savedId !== currentSelected)) {
        await storageSet({ notion_parent_page_id: currentSelected });
      }
    } finally {
      setParentPagesLoading(false);
    }
  }

  async function saveParentPage() {
    if (!els.notionPages) return;
    const id = els.notionPages.value;
    if (!id) return;
    await storageSet({ notion_parent_page_id: id });
  }

  function buildNotionAuthorizeUrl({ clientId, state }) {
    const cfg = NS.notionOAuthConfig && typeof NS.notionOAuthConfig.getDefaults === "function"
      ? NS.notionOAuthConfig.getDefaults()
      : null;
    const redirectUri = cfg && cfg.redirectUri ? String(cfg.redirectUri) : "https://chiimagnus.github.io/syncnos-oauth/callback";
    const base = cfg && cfg.authorizationUrl ? String(cfg.authorizationUrl) : "https://api.notion.com/v1/oauth/authorize";
    const owner = cfg && cfg.owner ? String(cfg.owner) : "user";
    const responseType = cfg && cfg.responseType ? String(cfg.responseType) : "code";
    const url = new URL(base);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", responseType);
    url.searchParams.set("owner", owner);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  let notionConnectPollTimer = null;
  let notionParentPagesLoaded = false;
  let notionParentControlsEnabled = false;
  let notionParentPagesLoading = false;

  function setNotionConnectBusy(busy) {
    if (!els.btnNotionConnect) return;
    els.btnNotionConnect.disabled = !!busy;
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

  function applyNotionParentControlsState() {
    const enabled = notionParentControlsEnabled && !notionParentPagesLoading;
    if (els.btnNotionLoadPages) {
      els.btnNotionLoadPages.disabled = !enabled;
      els.btnNotionLoadPages.classList.toggle("is-loading", notionParentPagesLoading);
    }
    if (els.notionPages) els.notionPages.disabled = !enabled;
  }

  function setNotionParentControlsEnabled(enabled) {
    notionParentControlsEnabled = !!enabled;
    applyNotionParentControlsState();
  }

  function setParentPagesLoading(loading) {
    notionParentPagesLoading = !!loading;
    applyNotionParentControlsState();
  }

  async function refreshNotionStatus() {
    const res = await send(notionTypes.GET_AUTH_STATUS);
    const meta = await getNotionOAuthMeta();
    if (!res || !res.ok || !res.data) {
      if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Not connected";
      if (els.btnNotionConnect) els.btnNotionConnect.textContent = "Connect";
      setParentPagesLoading(false);
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      stopNotionConnectPolling();
      notionParentPagesLoaded = false;
      setParentPagePlaceholder("Connect Notion to load pages.");
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
        loadParentPages().catch((e) => {
          notionParentPagesLoaded = false;
          setParentPagePlaceholder("Failed to load pages. Click refresh.");
          const msg = e && e.message ? e.message : String(e || "Failed to load Notion pages.");
          if (!refreshNotionStatus.__lastLoadPagesError || refreshNotionStatus.__lastLoadPagesError !== msg) {
            refreshNotionStatus.__lastLoadPagesError = msg;
            alert(`Failed to load Notion pages: ${msg}`);
          }
        });
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
      setParentPagesLoading(false);
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      notionParentPagesLoaded = false;
      setParentPagePlaceholder("Connect Notion to load pages.");
    }
  }

  function bindEvents() {
    if (els.btnNotionLoadPages) {
      els.btnNotionLoadPages.addEventListener("click", () => {
        loadParentPages()
          .then(() => flashOk(els.btnNotionLoadPages))
          .catch((e) => {
            setParentPagePlaceholder("Failed to load pages. Click refresh.");
            alert(e && e.message ? e.message : String(e));
          });
      });
    }

    if (els.notionPages) {
      els.notionPages.addEventListener("change", () => {
        saveParentPage().catch(() => {});
      });
    }

    if (els.btnNotionConnect) {
      els.btnNotionConnect.addEventListener("click", async () => {
        const status = await send(notionTypes.GET_AUTH_STATUS);
        if (status && status.ok && status.data && status.data.connected) {
          await send(notionTypes.DISCONNECT);
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
        const url = buildNotionAuthorizeUrl({ clientId, state });
        setNotionConnectBusy(true);
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Connecting…";
        const opened = typeof openHttpUrl === "function" ? openHttpUrl(url) : false;
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
    disableImageDrag(els.viewSettings);
    bindEvents();
    refreshNotionStatus().catch(() => {});
  }

  NS.popupNotion = {
    init,
    refreshNotionStatus
  };
})();

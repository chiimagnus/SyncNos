(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, send, flashOk } = core;
  const contracts = NS.messageContracts || {};
  const articleTypes = contracts.ARTICLE_MESSAGE_TYPES || {
    FETCH_ACTIVE_TAB: "fetchActiveTabArticle"
  };

  function setStatus(text, kind) {
    if (!els.articleFetchStatus) return;
    els.articleFetchStatus.textContent = String(text || "");
    els.articleFetchStatus.classList.remove("is-error", "is-ok", "is-loading");
    if (kind === "error") els.articleFetchStatus.classList.add("is-error");
    if (kind === "ok") els.articleFetchStatus.classList.add("is-ok");
    if (kind === "loading") els.articleFetchStatus.classList.add("is-loading");
  }

  async function handleFetch() {
    if (!els.btnFetchCurrentArticle) return;
    const btn = els.btnFetchCurrentArticle;
    const prevText = btn.textContent || "Fetch Current Page";

    btn.disabled = true;
    btn.textContent = "Fetching...";
    setStatus("Fetching article from active tab...", "loading");

    try {
      const res = await send(articleTypes.FETCH_ACTIVE_TAB);
      if (!res || !res.ok) {
        throw new Error((res && res.error && res.error.message) || "Article fetch failed.");
      }

      const data = res.data || {};
      const title = String(data.title || "").trim() || "Untitled";
      const count = Number.isFinite(Number(data.wordCount)) ? Number(data.wordCount) : 0;
      setStatus(`Saved: ${title} (${count} words)`, "ok");
      flashOk(btn);

      const tabs = NS.popupTabs;
      const list = NS.popupList;
      if (tabs && typeof tabs.setActiveTab === "function") {
        tabs.setActiveTab("chats");
      }
      if (list && typeof list.refresh === "function") {
        await list.refresh();
      }
    } catch (e) {
      const message = (e && e.message) ? String(e.message) : "Article fetch failed.";
      setStatus(message, "error");
      alert(message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function init() {
    if (!els.btnFetchCurrentArticle) return;
    setStatus("Idle");
    els.btnFetchCurrentArticle.addEventListener("click", () => {
      handleFetch().catch(() => {});
    });
  }

  NS.popupArticleFetch = {
    init
  };
})();

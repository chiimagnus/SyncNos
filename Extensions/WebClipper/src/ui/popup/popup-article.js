(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { send, els, flashOk } = core;
  const contracts = NS.messageContracts || {};
  const ARTICLE_TYPES = contracts.ARTICLE_MESSAGE_TYPES || { FETCH_ARTICLE: "fetchArticle" };
  const CORE_TYPES = contracts.CORE_MESSAGE_TYPES || {
    UPSERT_CONVERSATION: "upsertConversation",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages"
  };

  function generateArticleKeyFromUrl(url) {
    const normalized = String(url || "").trim().replace(/[#?].*$/, "").replace(/\/$/, "");
    return "article_" + normalized.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  }

  async function clipCurrentPage() {
    const btn = els && els.btnClipArticle;
    if (!btn || btn.disabled) return;
    const prevText = btn.textContent || "Clip";
    btn.disabled = true;
    btn.textContent = "Clipping...";
    try {
      // 1. Fetch article from current active tab via background.
      const res = await send(ARTICLE_TYPES.FETCH_ARTICLE, {});
      if (!res || !res.ok) {
        throw new Error((res && res.error && res.error.message) || "Article fetch failed");
      }
      const article = res.data;
      const url = String(article.url || "").trim();
      if (!url) throw new Error("Could not determine article URL");

      // 2. Upsert conversation as sourceType=article.
      const now = Date.now();
      const convoRes = await send(CORE_TYPES.UPSERT_CONVERSATION, {
        payload: {
          sourceType: "article",
          source: "article",
          conversationKey: generateArticleKeyFromUrl(url),
          title: article.title || url,
          url,
          author: article.author || "",
          description: article.excerpt || "",
          lastCapturedAt: now
        }
      });
      if (!convoRes || !convoRes.ok) {
        throw new Error((convoRes && convoRes.error && convoRes.error.message) || "Save failed");
      }
      const convo = convoRes.data;

      // 3. Save article text as a single assistant message.
      const msgRes = await send(CORE_TYPES.SYNC_CONVERSATION_MESSAGES, {
        conversationId: convo.id,
        messages: [{
          messageKey: "content",
          role: "assistant",
          contentText: article.text || "",
          sequence: 0,
          updatedAt: now
        }]
      });
      if (!msgRes || !msgRes.ok) {
        throw new Error((msgRes && msgRes.error && msgRes.error.message) || "Save messages failed");
      }

      // 4. Flash success and refresh list.
      flashOk(btn);
      const list = NS.popupList;
      if (list && typeof list.refresh === "function") {
        await list.refresh();
      }
    } catch (e) {
      alert((e && e.message) || "Clip article failed.");
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function init() {
    const btn = document.getElementById("btnClipArticle");
    if (!btn) return;
    if (els) els.btnClipArticle = btn;
    btn.addEventListener("click", () => { clipCurrentPage().catch(() => {}); });
  }

  NS.popupArticle = { init };
})();

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const {
    els,
    state,
    send,
    PREVIEW_EVENTS,
    formatTime,
    getSourceMeta
  } = core;
  const previewEvents = PREVIEW_EVENTS || {
    click: "popup:conversation-click"
  };

  const POPOVER_GAP = 8;
  const POPOVER_MARGIN = 8;
  const preview = {
    activeConversationId: null,
    activeAnchorEl: null
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "\"": return "&quot;";
        case "'": return "&#39;";
        default: return char;
      }
    });
  }

  function normalizeRole(role) {
    const normalized = String(role || "assistant").toLowerCase();
    if (normalized === "user") return "user";
    if (normalized === "assistant") return "assistant";
    return "other";
  }

  function roleLabel(role) {
    if (role === "user") return "User";
    if (role === "assistant") return "Assistant";
    return "Message";
  }

  function getPreviewCache() {
    if (!(state.previewCache instanceof Map)) state.previewCache = new Map();
    return state.previewCache;
  }

  function findConversationById(conversationId) {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return state.conversations.find((conversation) => Number(conversation && conversation.id) === id) || null;
  }

  function setAnchorActive(anchorEl, active) {
    if (!anchorEl || !anchorEl.classList) return;
    anchorEl.classList.toggle("is-preview-anchor", !!active);
  }

  function invalidatePendingRequests() {
    const token = Number(state.previewRequestToken);
    state.previewRequestToken = Number.isFinite(token) ? token + 1 : 1;
  }

  function hideNow() {
    state.hoveredConversationId = null;
    invalidatePendingRequests();

    if (preview.activeAnchorEl) setAnchorActive(preview.activeAnchorEl, false);
    preview.activeConversationId = null;
    preview.activeAnchorEl = null;

    if (!els.chatPreviewPopover) return;
    els.chatPreviewPopover.hidden = true;
    els.chatPreviewPopover.innerHTML = "";
    els.chatPreviewPopover.removeAttribute("data-state");
  }

  function formatSubtitle(conversation) {
    if (!conversation) return "";
    const parts = [];
    const sourceRaw = conversation.sourceName || conversation.source || "";
    const sourceMeta = getSourceMeta(sourceRaw);
    if (sourceMeta && sourceMeta.label) parts.push(sourceMeta.label);
    const lastCapturedAt = formatTime(conversation.lastCapturedAt);
    if (lastCapturedAt) parts.push(lastCapturedAt);
    return parts.join(" · ");
  }

  function renderShell({ conversation, bodyHtml, stateName }) {
    if (!els.chatPreviewPopover) return;
    const title = (conversation && conversation.title) ? conversation.title : "(untitled)";
    const subtitle = formatSubtitle(conversation);

    els.chatPreviewPopover.innerHTML = `
      <div class="chatPreviewHeader">
        <div class="chatPreviewTitle">${escapeHtml(title)}</div>
        <div class="chatPreviewSub">${escapeHtml(subtitle || "Conversation preview")}</div>
      </div>
      <div class="chatPreviewBody">${bodyHtml}</div>
    `;
    els.chatPreviewPopover.dataset.state = String(stateName || "ready");
  }

  function renderLoading(conversation) {
    renderShell({
      conversation,
      stateName: "loading",
      bodyHtml: '<div class="chatPreviewPlaceholder">Loading...</div>'
    });
  }

  function renderError(conversation, message) {
    renderShell({
      conversation,
      stateName: "error",
      bodyHtml: `<div class="chatPreviewPlaceholder chatPreviewPlaceholder--error">${escapeHtml(message || "Failed to load messages.")}</div>`
    });
  }

  function renderMessages(conversation, messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      renderShell({
        conversation,
        stateName: "empty",
        bodyHtml: '<div class="chatPreviewPlaceholder">No messages yet.</div>'
      });
      return;
    }

    const bodyHtml = list.map((message) => {
      const normalizedRole = normalizeRole(message && message.role);
      const label = roleLabel(normalizedRole);
      const content = escapeHtml((message && message.contentText) || "");
      return `
        <article class="chatPreviewMsg chatPreviewMsg--${normalizedRole}">
          <header class="chatPreviewMsgRole">${label}</header>
          <pre class="chatPreviewMsgText">${content}</pre>
        </article>
      `;
    }).join("");

    renderShell({
      conversation,
      stateName: "ready",
      bodyHtml
    });
  }

  function positionPopover() {
    if (!els.chatPreviewPopover || !preview.activeAnchorEl || els.chatPreviewPopover.hidden) return;
    const anchorRect = preview.activeAnchorEl.getBoundingClientRect();
    const popoverRect = els.chatPreviewPopover.getBoundingClientRect();

    let left = anchorRect.right + POPOVER_GAP;
    if (left + popoverRect.width > window.innerWidth - POPOVER_MARGIN) {
      left = anchorRect.left - popoverRect.width - POPOVER_GAP;
    }
    left = Math.max(POPOVER_MARGIN, Math.min(left, window.innerWidth - popoverRect.width - POPOVER_MARGIN));

    let top = anchorRect.top;
    if (top + popoverRect.height > window.innerHeight - POPOVER_MARGIN) {
      top = window.innerHeight - popoverRect.height - POPOVER_MARGIN;
    }
    top = Math.max(POPOVER_MARGIN, top);

    els.chatPreviewPopover.style.left = `${Math.round(left)}px`;
    els.chatPreviewPopover.style.top = `${Math.round(top)}px`;
  }

  function revealPopover(anchorEl) {
    if (!els.chatPreviewPopover || !anchorEl) return;
    if (preview.activeAnchorEl && preview.activeAnchorEl !== anchorEl) {
      setAnchorActive(preview.activeAnchorEl, false);
    }
    preview.activeAnchorEl = anchorEl;
    setAnchorActive(anchorEl, true);
    els.chatPreviewPopover.hidden = false;
    positionPopover();
  }

  async function fetchMessages(conversationId) {
    const cache = getPreviewCache();
    if (cache.has(conversationId)) return cache.get(conversationId);

    const res = await send("getConversationDetail", { conversationId });
    if (!res || !res.ok) {
      throw new Error((res && res.error && res.error.message) || "Failed to load messages.");
    }
    const messages = (res && res.data && Array.isArray(res.data.messages)) ? res.data.messages : [];
    const payload = { messages, fetchedAt: Date.now() };
    cache.set(conversationId, payload);
    return payload;
  }

  async function showPreview({ conversationId, anchorEl }) {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0 || !anchorEl) return;
    const conversation = findConversationById(id);
    if (!conversation) return;

    state.hoveredConversationId = id;
    preview.activeConversationId = id;
    revealPopover(anchorEl);

    const cache = getPreviewCache();
    const cached = cache.get(id);
    if (cached && Array.isArray(cached.messages)) {
      renderMessages(conversation, cached.messages);
      positionPopover();
      return;
    }

    renderLoading(conversation);
    positionPopover();

    invalidatePendingRequests();
    const token = state.previewRequestToken;
    try {
      const payload = await fetchMessages(id);
      if (token !== state.previewRequestToken) return;
      if (preview.activeConversationId !== id) return;
      renderMessages(conversation, payload.messages);
      positionPopover();
    } catch (e) {
      if (token !== state.previewRequestToken) return;
      if (preview.activeConversationId !== id) return;
      renderError(conversation, e && e.message ? e.message : "Failed to load messages.");
      positionPopover();
    }
  }

  function handleClickPreview(e) {
    if (!e || !e.detail) return;
    showPreview({
      conversationId: e.detail.conversationId,
      anchorEl: e.detail.anchorEl
    }).catch(() => {});
  }

  function init() {
    if (!els.list || !els.chatPreviewPopover) return;

    els.list.addEventListener(previewEvents.click, handleClickPreview);

    document.addEventListener("click", (e) => {
      if (!preview.activeConversationId || !els.chatPreviewPopover || els.chatPreviewPopover.hidden) return;
      const target = e && e.target;
      if (!target) return;
      if ((preview.activeAnchorEl && preview.activeAnchorEl.contains(target)) || els.chatPreviewPopover.contains(target)) return;
      hideNow();
    });

    document.addEventListener("keydown", (e) => {
      if (!e || e.key !== "Escape") return;
      hideNow();
    });

    window.addEventListener("resize", () => {
      if (!els.chatPreviewPopover || els.chatPreviewPopover.hidden) return;
      positionPopover();
    });

    if (els.chatsMain) {
      els.chatsMain.addEventListener("scroll", () => {
        if (!els.chatPreviewPopover || els.chatPreviewPopover.hidden) return;
        if (!preview.activeAnchorEl || !document.contains(preview.activeAnchorEl)) {
          hideNow();
          return;
        }
        positionPopover();
      }, { passive: true });
    }
  }

  NS.popupChatPreview = {
    init
  };
})();

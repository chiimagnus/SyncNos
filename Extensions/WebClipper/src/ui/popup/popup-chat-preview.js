(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const {
    els,
    state,
    send,
    PREVIEW_EVENTS
  } = core;
  const previewEvents = PREVIEW_EVENTS || {
    click: "popup:conversation-click"
  };

  const POPOVER_MARGIN = 8;
  const preview = {
    activeConversationId: null,
    activeAnchorEl: null
  };
  let markdownRenderer;

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

  const sanitizeHref = core.sanitizeHttpUrl || ((href) => {
    const text = String(href || "").trim();
    if (!text) return "";
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  });

  function getMarkdownRenderer() {
    if (markdownRenderer !== undefined) return markdownRenderer;
    const factory = globalThis.markdownit;
    if (typeof factory !== "function") {
      markdownRenderer = null;
      return markdownRenderer;
    }

    const md = factory({
      html: false,
      breaks: true,
      linkify: true,
      typographer: false
    });
    try {
      if (typeof md.enable === "function") md.enable(["table"]);
    } catch (_e) {
      // ignore
    }
    const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => {
      return self.renderToken(tokens, idx, options);
    });
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const hrefIdx = token.attrIndex("href");
      const href = hrefIdx >= 0 && token.attrs && token.attrs[hrefIdx] ? token.attrs[hrefIdx][1] : "";
      const safeHref = sanitizeHref(href);
      if (!safeHref) token.attrSet("href", "#");
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    markdownRenderer = md;
    return markdownRenderer;
  }

  function renderMarkdown(contentText) {
    const raw = String(contentText || "");
    if (!raw.trim()) return "<p></p>";
    const md = getMarkdownRenderer();
    if (!md) return `<p>${escapeHtml(raw).replace(/\n/g, "<br>")}</p>`;
    try {
      return md.render(raw);
    } catch (_e) {
      return `<p>${escapeHtml(raw).replace(/\n/g, "<br>")}</p>`;
    }
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
    invalidatePendingRequests();

    if (preview.activeAnchorEl) setAnchorActive(preview.activeAnchorEl, false);
    preview.activeConversationId = null;
    preview.activeAnchorEl = null;

    if (!els.chatPreviewPopover) return;
    els.chatPreviewPopover.hidden = true;
    els.chatPreviewPopover.replaceChildren();
    els.chatPreviewPopover.removeAttribute("data-state");
  }

  function renderShell({ bodyHtml, stateName }) {
    if (!els.chatPreviewPopover) return;
    const body = document.createElement("div");
    body.className = "chatPreviewBody";
    const html = String(bodyHtml || "");
    if (html) {
      const range = document.createRange();
      range.selectNode(body);
      body.appendChild(range.createContextualFragment(html));
    }
    els.chatPreviewPopover.replaceChildren(body);
    els.chatPreviewPopover.dataset.state = String(stateName || "ready");
  }

  function renderLoading() {
    renderShell({
      stateName: "loading",
      bodyHtml: '<div class="chatPreviewPlaceholder">Loading...</div>'
    });
  }

  function renderError(message) {
    renderShell({
      stateName: "error",
      bodyHtml: `<div class="chatPreviewPlaceholder chatPreviewPlaceholder--error">${escapeHtml(message || "Failed to load messages.")}</div>`
    });
  }

  function renderMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      renderShell({
        stateName: "empty",
        bodyHtml: '<div class="chatPreviewPlaceholder">No messages yet.</div>'
      });
      return;
    }

    const bodyHtml = list.map((message) => {
      const normalizedRole = normalizeRole(message && message.role);
      const label = roleLabel(normalizedRole);
      const content = renderMarkdown((message && (message.contentMarkdown || message.contentText)) || "");
      return `
        <article class="chatPreviewMsg chatPreviewMsg--${normalizedRole}">
          <header class="chatPreviewMsgRole">${label}</header>
          <div class="chatPreviewMsgMarkdown">${content}</div>
        </article>
      `;
    }).join("");

    renderShell({
      stateName: "ready",
      bodyHtml
    });
  }

  function positionPopover() {
    if (!els.chatPreviewPopover || els.chatPreviewPopover.hidden) return;
    const chatsRect = (els.viewChats && typeof els.viewChats.getBoundingClientRect === "function")
      ? els.viewChats.getBoundingClientRect()
      : null;
    const top = chatsRect
      ? Math.max(0, Math.round(chatsRect.top))
      : 0;
    const maxHeight = Math.max(140, window.innerHeight - top - POPOVER_MARGIN);

    els.chatPreviewPopover.style.left = "auto";
    els.chatPreviewPopover.style.right = `${POPOVER_MARGIN}px`;
    els.chatPreviewPopover.style.top = `${top}px`;
    els.chatPreviewPopover.style.maxHeight = `${Math.round(maxHeight)}px`;
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

    preview.activeConversationId = id;
    revealPopover(anchorEl);

    const cache = getPreviewCache();
    const cached = cache.get(id);
    if (cached && Array.isArray(cached.messages)) {
      renderMessages(cached.messages);
      positionPopover();
      return;
    }

    renderLoading();
    positionPopover();

    invalidatePendingRequests();
    const token = state.previewRequestToken;
    try {
      const payload = await fetchMessages(id);
      if (token !== state.previewRequestToken) return;
      if (preview.activeConversationId !== id) return;
      renderMessages(payload.messages);
      positionPopover();
    } catch (e) {
      if (token !== state.previewRequestToken) return;
      if (preview.activeConversationId !== id) return;
      renderError(e && e.message ? e.message : "Failed to load messages.");
      positionPopover();
    }
  }

  function handleClickPreview(e) {
    if (!e || !e.detail) return;
    const conversationId = Number(e.detail.conversationId);
    if (Number.isFinite(conversationId)
      && conversationId > 0
      && preview.activeConversationId === conversationId
      && els.chatPreviewPopover
      && !els.chatPreviewPopover.hidden) {
      hideNow();
      return;
    }
    showPreview({
      conversationId,
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
      if (!preview.activeConversationId || !els.chatPreviewPopover || els.chatPreviewPopover.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      hideNow();
    }, true);

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

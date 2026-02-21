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

    markdownRenderer = md;
    return markdownRenderer;
  }

  function getAttr(token, name) {
    if (!token || !Array.isArray(token.attrs)) return "";
    for (const pair of token.attrs) {
      if (pair && pair[0] === name) return pair[1] || "";
    }
    return "";
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(String(text || "")));
  }

  function renderInlineTokens(parent, tokens) {
    const stack = [parent];
    const ensureParent = () => stack[stack.length - 1] || parent;

    for (const token of tokens || []) {
      if (!token) continue;

      if (token.type === "text") {
        appendText(ensureParent(), token.content || "");
        continue;
      }
      if (token.type === "softbreak" || token.type === "hardbreak") {
        ensureParent().appendChild(document.createElement("br"));
        continue;
      }
      if (token.type === "code_inline") {
        const el = document.createElement("code");
        el.textContent = token.content || "";
        ensureParent().appendChild(el);
        continue;
      }
      if (token.type === "image") {
        const src = getAttr(token, "src");
        const safeSrc = sanitizeHref(src);
        const alt = token.content || getAttr(token, "alt") || "";
        if (!safeSrc) {
          if (alt) appendText(ensureParent(), alt);
          continue;
        }

        const wrap = document.createElement("div");
        wrap.className = "chatPreviewImage";

        const link = document.createElement("a");
        link.setAttribute("href", safeSrc);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");

        const img = document.createElement("img");
        img.className = "chatPreviewImageImg";
        img.src = safeSrc;
        img.alt = alt;
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";

        link.appendChild(img);
        wrap.appendChild(link);

        const urlLine = document.createElement("div");
        urlLine.className = "chatPreviewImageUrl";
        const urlLink = document.createElement("a");
        urlLink.setAttribute("href", safeSrc);
        urlLink.setAttribute("target", "_blank");
        urlLink.setAttribute("rel", "noopener noreferrer");
        urlLink.textContent = safeSrc;
        urlLink.title = safeSrc;
        urlLine.appendChild(urlLink);
        wrap.appendChild(urlLine);

        ensureParent().appendChild(wrap);
        continue;
      }

      if (token.nesting === 1) {
        const el = token.tag ? document.createElement(token.tag) : document.createElement("span");
        if (token.type === "link_open") {
          const href = getAttr(token, "href");
          const safeHref = sanitizeHref(href);
          el.setAttribute("href", safeHref || "#");
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
        ensureParent().appendChild(el);
        stack.push(el);
        continue;
      }

      if (token.nesting === -1) {
        if (stack.length > 1) stack.pop();
        continue;
      }
    }
  }

  function renderMarkdownInto(container, contentText) {
    if (!container) return;
    const raw = String(contentText || "");
    container.replaceChildren();

    if (!raw.trim()) {
      container.appendChild(document.createElement("p"));
      return;
    }

    const md = getMarkdownRenderer();
    if (!md || typeof md.parse !== "function") {
      const p = document.createElement("p");
      p.textContent = raw;
      container.appendChild(p);
      return;
    }

    let tokens;
    try {
      tokens = md.parse(raw, {});
    } catch (_e) {
      const p = document.createElement("p");
      p.textContent = raw;
      container.appendChild(p);
      return;
    }

    const stack = [container];
    const ensureParent = () => stack[stack.length - 1] || container;

    for (const token of tokens || []) {
      if (!token) continue;

      if (token.type === "inline") {
        renderInlineTokens(ensureParent(), token.children || []);
        continue;
      }

      if (token.type === "fence" || token.type === "code_block") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = token.content || "";
        pre.appendChild(code);
        ensureParent().appendChild(pre);
        continue;
      }

      if (token.type === "hr") {
        ensureParent().appendChild(document.createElement("hr"));
        continue;
      }

      if (token.nesting === 1) {
        const el = token.tag ? document.createElement(token.tag) : document.createElement("div");
        if (token.type === "ordered_list_open") {
          const start = getAttr(token, "start");
          if (start) el.setAttribute("start", String(start));
        }
        ensureParent().appendChild(el);
        stack.push(el);
        continue;
      }

      if (token.nesting === -1) {
        if (stack.length > 1) stack.pop();
        continue;
      }
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

  function renderShell({ bodyNode, stateName }) {
    if (!els.chatPreviewPopover) return;
    const body = document.createElement("div");
    body.className = "chatPreviewBody";
    if (bodyNode) body.appendChild(bodyNode);
    els.chatPreviewPopover.replaceChildren(body);
    els.chatPreviewPopover.dataset.state = String(stateName || "ready");
  }

  function renderLoading() {
    const el = document.createElement("div");
    el.className = "chatPreviewPlaceholder";
    el.textContent = "Loading...";
    renderShell({
      stateName: "loading",
      bodyNode: el
    });
  }

  function renderError(message) {
    const el = document.createElement("div");
    el.className = "chatPreviewPlaceholder chatPreviewPlaceholder--error";
    el.textContent = message || "Failed to load messages.";
    renderShell({
      stateName: "error",
      bodyNode: el
    });
  }

  function renderMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      const el = document.createElement("div");
      el.className = "chatPreviewPlaceholder";
      el.textContent = "No messages yet.";
      renderShell({
        stateName: "empty",
        bodyNode: el
      });
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const message of list) {
      const normalizedRole = normalizeRole(message && message.role);
      const label = roleLabel(normalizedRole);
      const article = document.createElement("article");
      article.className = `chatPreviewMsg chatPreviewMsg--${normalizedRole}`;

      const header = document.createElement("header");
      header.className = "chatPreviewMsgRole";
      header.textContent = label;

      const contentWrap = document.createElement("div");
      contentWrap.className = "chatPreviewMsgMarkdown";
      const content = (message && (message.contentMarkdown || message.contentText)) || "";
      renderMarkdownInto(contentWrap, content);

      article.appendChild(header);
      article.appendChild(contentWrap);
      fragment.appendChild(article);
    }

    renderShell({
      stateName: "ready",
      bodyNode: fragment
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

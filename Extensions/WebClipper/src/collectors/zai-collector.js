(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "chat.z.ai";
  }

  function findConversationIdFromUrl() {
    const m = String(location.pathname || "").match(/^\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : "";
  }

  function isValidConversationUrl() {
    try {
      return !!findConversationIdFromUrl();
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return findConversationIdFromUrl() || (NS.collectorUtils && NS.collectorUtils.conversationKeyFromLocation
      ? NS.collectorUtils.conversationKeyFromLocation(location)
      : "");
  }

  function findTitle() {
    return document.title || "z.ai";
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root) {
    const utils = NS.collectorUtils;
    if (utils && typeof utils.inEditMode === "function") return utils.inEditMode(root);
    return false;
  }

  function sortByDomOrder(nodes) {
    const sorted = Array.from(nodes || []);
    sorted.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return sorted;
  }

  function isUserWrapper(wrapper) {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("user-message")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".user-message, .chat-user"));
  }

  function isAssistantWrapper(wrapper) {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("chat-assistant")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".chat-assistant"));
  }

  function removeThinkingNodes(container) {
    if (!container || !container.querySelectorAll) return container;
    const selectors = [
      ".thinking-chain-container",
      // Some layouts render the thinking content in a separate block (often hidden/collapsed).
      ".thinking-block",
      // z.ai thinking block uses `data-direct="false"` in current DOM.
      "[data-direct='false']"
    ];
    for (const sel of selectors) {
      container.querySelectorAll(sel).forEach((el) => {
        try {
          el.remove();
        } catch (_e) {
          // ignore
        }
      });
    }
    return container;
  }

  function removeNonContentNodes(container) {
    if (!container || !container.querySelectorAll) return container;
    // Strip UI/control elements that can leak into textContent when innerText is unreliable.
    container.querySelectorAll("button, svg, path, textarea, input, select, option, script, style").forEach((el) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });
    return container;
  }

  function normalizeMarkdown(markdown) {
    const s = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // Keep leading indentation (important for markdown), but trim trailing whitespace.
    const lines = s.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function pickCodeLanguage(className) {
    const raw = String(className || "");
    if (!raw) return "";
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(language|lang)-([a-z0-9_+-]+)$/i);
      if (m && m[2]) return String(m[2]).toLowerCase();
    }
    return "";
  }

  function wrapInlineCode(text) {
    const s = String(text || "");
    if (!s) return "``";
    const matches = s.match(/`+/g) || [];
    const maxTicks = matches.reduce((m, t) => Math.max(m, t.length), 0);
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    return `${fence}${s}${fence}`;
  }

  function htmlToMarkdown(root) {
    if (!root) return "";
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function renderChildren(el, ctx) {
      const out = [];
      const kids = el && el.childNodes ? Array.from(el.childNodes) : [];
      for (const c of kids) out.push(renderNode(c, ctx));
      return out.join("");
    }

    function renderList(listEl, ordered, ctx) {
      const depth = (ctx && Number.isFinite(ctx.listDepth)) ? ctx.listDepth : 0;
      const indent = "  ".repeat(Math.max(0, depth));
      const items = [];
      const children = listEl && listEl.children ? Array.from(listEl.children) : [];
      for (const child of children) {
        if (!child || String(child.tagName || "").toLowerCase() !== "li") continue;
        const childCtx = { ...ctx, listDepth: depth + 1 };
        const body = normalizeMarkdown(renderChildren(child, childCtx)).replace(/\n{2,}/g, "\n");
        const bullet = ordered ? "1." : "-";
        const lines = String(body || "").split("\n").filter((l) => l.length);
        if (!lines.length) continue;
        const first = `${indent}${bullet} ${lines[0]}`;
        const rest = lines.slice(1).map((l) => `${indent}  ${l}`);
        items.push([first, ...rest].join("\n"));
      }
      return items.join("\n") + (items.length ? "\n\n" : "");
    }

    function renderBlockquote(el, ctx) {
      const raw = normalizeMarkdown(renderChildren(el, ctx));
      if (!raw) return "";
      const lines = raw.split("\n");
      const quoted = lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
      return `${quoted}\n\n`;
    }

    function renderNode(node, ctx) {
      if (!node) return "";
      if (node.nodeType === TEXT_NODE) {
        return node.nodeValue ? String(node.nodeValue) : "";
      }
      if (node.nodeType !== ELEMENT_NODE) return "";

      const tag = node.tagName ? String(node.tagName).toLowerCase() : "";
      if (!tag) return renderChildren(node, ctx);

      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";

      // Skip non-content tags defensively.
      if (tag === "script" || tag === "style" || tag === "svg" || tag === "path" || tag === "button") return "";

      if (tag === "pre") {
        const codeEl = node.querySelector ? node.querySelector("code") : null;
        const lang = pickCodeLanguage(codeEl && codeEl.getAttribute ? codeEl.getAttribute("class") : "");
        const text = String((codeEl ? (codeEl.textContent || "") : (node.textContent || "")) || "").replace(/\n+$/g, "");
        if (!text.trim()) return "";
        return `\n\n\`\`\`${lang || ""}\n${text}\n\`\`\`\n\n`;
      }

      if (tag === "code") {
        // Inline code (code blocks handled by <pre>).
        const text = String(node.textContent || "");
        return wrapInlineCode(text);
      }

      if (tag === "strong" || tag === "b") return `**${renderChildren(node, ctx)}**`;
      if (tag === "em" || tag === "i") return `*${renderChildren(node, ctx)}*`;
      if (tag === "del" || tag === "s") return `~~${renderChildren(node, ctx)}~~`;

      if (tag === "a") {
        const href = node.getAttribute ? String(node.getAttribute("href") || "") : "";
        const text = normalizeMarkdown(renderChildren(node, ctx));
        if (href && /^https?:\/\//i.test(href)) {
          return `[${text || href}](${href})`;
        }
        return text;
      }

      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
        const text = normalizeMarkdown(renderChildren(node, ctx));
        if (!text) return "";
        return `${"#".repeat(level)} ${text}\n\n`;
      }

      if (tag === "ul") return renderList(node, false, ctx);
      if (tag === "ol") return renderList(node, true, ctx);

      if (tag === "blockquote") return renderBlockquote(node, ctx);

      if (tag === "p") {
        const text = normalizeMarkdown(renderChildren(node, ctx));
        return text ? `${text}\n\n` : "";
      }

      if (tag === "li") {
        // Usually handled by parent <ul>/<ol>, but keep a safe fallback.
        const text = normalizeMarkdown(renderChildren(node, ctx));
        return text ? `${text}\n` : "";
      }

      // Default: just render children; add paragraph breaks for common block containers.
      const rendered = renderChildren(node, ctx);
      if (tag === "div" || tag === "section" || tag === "article") return rendered;
      return rendered;
    }

    return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
  }

  function extractTextFromSanitizedClone(clone) {
    if (!clone) return "";

    // Prefer innerText (keeps line breaks). Must not mutate the real DOM, or we'd
    // self-trigger the MutationObserver in auto-capture.
    const inner = typeof clone.innerText === "string" ? clone.innerText : "";
    if (inner && inner.trim()) return inner;

    const blockTags = new Set([
      "P",
      "DIV",
      "LI",
      "UL",
      "OL",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
      "PRE",
      "SECTION",
      "ARTICLE"
    ]);

    const parts = [];
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function walk(node) {
      if (!node) return;
      const t = node.nodeType;
      if (t === TEXT_NODE) {
        const v = node.nodeValue ? String(node.nodeValue) : "";
        if (v) parts.push(v);
        return;
      }
      if (t !== ELEMENT_NODE) return;

      const tag = node.tagName ? String(node.tagName).toUpperCase() : "";
      if (tag === "BR") {
        parts.push("\n");
        return;
      }

      const children = node.childNodes ? Array.from(node.childNodes) : [];
      for (const c of children) walk(c);

      if (blockTags.has(tag)) {
        parts.push("\n\n");
      }
    }

    walk(clone);
    return parts.join("");
  }

  function extractAssistantMarkdown(wrapper) {
    if (!wrapper || !wrapper.querySelector) return "";
    const content = wrapper.querySelector("#response-content-container") || wrapper.querySelector(".chat-assistant") || wrapper;
    try {
      const cloned = content.cloneNode(true);
      removeThinkingNodes(cloned);
      removeNonContentNodes(cloned);
      const md = htmlToMarkdown(cloned);
      return md || "";
    } catch (_e) {
      return "";
    }
  }

  function extractUserText(wrapper) {
    const node = (wrapper && wrapper.querySelector)
      ? (wrapper.querySelector(".whitespace-pre-wrap") || wrapper)
      : wrapper;
    const text = node && (node.innerText || node.textContent) ? (node.innerText || node.textContent) : "";
    return NS.normalize.normalizeText(text);
  }

  function extractAssistantText(wrapper) {
    if (!wrapper || !wrapper.querySelector) return "";
    const content = wrapper.querySelector("#response-content-container") || wrapper.querySelector(".chat-assistant") || wrapper;

    let node = content;
    try {
      const cloned = content.cloneNode(true);
      removeThinkingNodes(cloned);
      removeNonContentNodes(cloned);
      node = cloned;
    } catch (_e) {
      node = content;
    }

    const raw = node ? extractTextFromSanitizedClone(node) : "";
    return NS.normalize.normalizeText(raw);
  }

  function getMessageWrappers(root) {
    const scope = root || document;
    const candidates = Array.from(scope.querySelectorAll("div[id^='message-']"));
    // Keep only wrappers we can classify; avoid catching nested structural nodes if any.
    const filtered = candidates.filter((w) => isUserWrapper(w) || isAssistantWrapper(w));
    return sortByDomOrder(filtered);
  }

  function messageKeyFromWrapper(wrapper, role, contentText, sequence) {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    return NS.normalize.makeFallbackMessageKey({ role, contentText, sequence });
  }

  function collectMessages({ allowEditing } = {}) {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const out = [];
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      if (!contentText) continue;
      const contentMarkdown = role === "assistant"
        ? (extractAssistantMarkdown(w) || contentText)
        : contentText;
      out.push({
        messageKey: messageKeyFromWrapper(w, role, contentText, seq),
        role,
        contentText,
        contentMarkdown,
        sequence: seq,
        updatedAt: Date.now()
      });
      seq += 1;
    }
    return out;
  }

  function capture(options) {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages({ allowEditing: !!(options && options.manual) });
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "zai",
        conversationKey: findConversationKey(),
        title: findTitle(),
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.zai = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "zai", matches, collector: api });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ...api,
      __test: {
        removeThinkingNodes,
        removeNonContentNodes,
        normalizeMarkdown,
        htmlToMarkdown,
        extractTextFromSanitizedClone,
        extractAssistantMarkdown,
        extractAssistantText
      }
    };
  }
})();

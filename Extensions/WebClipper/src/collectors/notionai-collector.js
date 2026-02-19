(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function findChatThreadIdFromHref(href) {
    try {
      const u = new URL(String(href || location.href || ""));
      const t = String(u.searchParams.get("t") || "").trim();
      if (/^[0-9a-fA-F]{32}$/.test(t)) return t.toLowerCase();
      const hash = String(u.hash || "").replace(/^#/, "");
      const m = hash.match(/(?:^|[?&])t=([0-9a-fA-F]{32})(?:[&#]|$)/);
      return m ? String(m[1]).toLowerCase() : "";
    } catch (_e) {
      return "";
    }
  }

  function notionAiCanonicalChatUrl(threadId) {
    if (!threadId) return "";
    return `https://www.notion.so/chat?t=${threadId}&wfv=chat`;
  }

  function hasChatSignals(scope) {
    const s = scope || document;
    // NotionAI chat turns include this marker on user messages (observed across page/side-panel/floating dialog).
    return !!s.querySelector("[data-agent-chat-user-step-id]");
  }

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    if (!/(^|\.)notion\.so$/.test(hostname)) return false;
    // Important: do not activate on normal Notion pages, otherwise we can capture page blocks as "assistant" turns.
    return hasChatSignals(document);
  }

  function inpageMatches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    // UI eligibility: show the inpage button on Notion pages even before chat turns render.
    // Actual capture is still guarded by `isNotionAiPage()`.
    return /(^|\.)notion\.so$/.test(hostname);
  }

  function isNotionAiPage() {
    return /(^|\.)notion\.so$/.test(location.hostname) && hasChatSignals(document);
  }

  function getAnyUserStepEl(scope) {
    return (scope || document).querySelector("[data-agent-chat-user-step-id]");
  }

  function findScrollContainerFromSeed(seed) {
    if (!seed) return null;
    let el = seed.parentElement;
    for (let i = 0; i < 20 && el; i += 1) {
      try {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY || "";
        if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 20) {
          return el;
        }
      } catch (_e) {
        // ignore
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function findScrollContainer() {
    return findScrollContainerFromSeed(getAnyUserStepEl());
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return false;
    if (r.bottom < 0 || r.right < 0) return false;
    if (r.top > window.innerHeight || r.left > window.innerWidth) return false;
    return true;
  }

  function rectVisibleArea(r) {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return w * h;
  }

  function findCandidateRoots() {
    const seeds = Array.from(document.querySelectorAll("[data-agent-chat-user-step-id]")).slice(0, 20);
    if (!seeds.length) return [];
    const set = new Set();
    for (const s of seeds) {
      const root = findScrollContainerFromSeed(s);
      if (root) set.add(root);
    }
    const roots = Array.from(set).filter(isVisible);
    if (!roots.length) {
      const fallback = findScrollContainer();
      if (fallback) roots.push(fallback);
    }
    return roots;
  }

  function rootScore(root) {
    if (!root) return -Infinity;
    const userCount = root.querySelectorAll("[data-agent-chat-user-step-id]").length;
    const blockCount = root.querySelectorAll("div[data-block-id]").length;
    const rect = root.getBoundingClientRect ? root.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
    const area = rectVisibleArea(rect);
    // Prefer containers with many user turns but fewer generic Notion blocks (reduce capturing page content).
    return userCount * 100000 - blockCount * 10 + area / 1000;
  }

  function pickBestRoot(roots) {
    if (!roots || !roots.length) return { root: null, allRoots: [], lowConfidence: true };
    let best = roots[0];
    let bestScore = -Infinity;
    for (const r of roots) {
      const score = rootScore(r);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    const userCount = best ? best.querySelectorAll("[data-agent-chat-user-step-id]").length : 0;
    return { root: best, allRoots: roots, lowConfidence: roots.length !== 1 || userCount < 1 };
  }

  function getTurnWrappers(root) {
    const uniqueNodes = new Set();
    const scope = root || document;

    // user wrapper
    scope.querySelectorAll("[data-agent-chat-user-step-id]").forEach((el) => uniqueNodes.add(el));

    // assistant wrapper: find a container for blocks, but exclude big containers that also include user steps.
    scope.querySelectorAll("div[data-block-id]").forEach((block) => {
      const w = block.closest(".autolayout-col.autolayout-fill-width") || block.closest("div");
      if (!w) return;
      if (w.querySelector("[data-agent-chat-user-step-id]")) return;
      // Ensure it's within our scope (closest may escape shadow-like boundaries).
      if (scope !== document && !scope.contains(w)) return;
      uniqueNodes.add(w);
    });

    const sorted = Array.from(uniqueNodes);
    sorted.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const finalNodes = [];
    for (const node of sorted) {
      const isChild = finalNodes.some((parent) => parent.contains(node));
      if (!isChild) finalNodes.push(node);
    }
    return finalNodes;
  }

  function roleFromWrapper(wrapper) {
    if (wrapper && wrapper.getAttribute && wrapper.getAttribute("data-agent-chat-user-step-id")) return "user";
    return "assistant";
  }

  function extractUserText(wrapper) {
    const leaf =
      wrapper.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
      wrapper.querySelector("[data-content-editable-leaf='true']");
    const raw = leaf ? (leaf.innerText || leaf.textContent || "") : (wrapper.innerText || wrapper.textContent || "");
    return NS.normalize.normalizeText(raw);
  }

  function extractAssistantText(wrapper) {
    const blocks = Array.from(wrapper.querySelectorAll("div[data-block-id]"));
    if (!blocks.length) {
      const raw = wrapper.innerText || wrapper.textContent || "";
      return NS.normalize.normalizeText(raw);
    }
    const topBlocks = blocks.filter((b) => isTopLevelBlock(b, wrapper));
    const parts = [];
    for (const b of topBlocks) {
      const raw = b.innerText || b.textContent || "";
      const t = NS.normalize.normalizeText(raw);
      if (t) parts.push(t);
    }
    return NS.normalize.normalizeText(parts.join("\n"));
  }

  function findPageIdFromUrl() {
    const m = location.pathname.match(/[0-9a-fA-F]{32}/);
    return m ? m[0].toLowerCase() : "";
  }

  function getChatTitleFromHistoryButton() {
    // Observed DOM (see `.github/docs/notionAIDOM.md`):
    // <div role="button" aria-label="history"> <div>Title...</div> ... </div>
    const btn = document.querySelector('div[role="button"][aria-label="history"]');
    if (!btn) return "";
    const titleEl = btn.firstElementChild;
    const raw = titleEl ? (titleEl.innerText || titleEl.textContent || "") : (btn.innerText || btn.textContent || "");
    const title = String(raw || "").split("\n").join(" ").trim();
    return title ? title.slice(0, 80) : "";
  }

  function getChatTitleFromRoot(root) {
    const fromHistory = getChatTitleFromHistoryButton();
    if (fromHistory) return fromHistory;

    const firstUser = getAnyUserStepEl(root) || getAnyUserStepEl(document);
    if (!firstUser) return "NotionAI Chat";
    const leaf =
      firstUser.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
      firstUser.querySelector("[data-content-editable-leaf='true']");
    const raw = leaf ? (leaf.innerText || leaf.textContent || "") : (firstUser.innerText || firstUser.textContent || "");
    const title = String(raw || "").split("\n").join(" ").trim().slice(0, 60);
    return title || "NotionAI Chat";
  }

  function capture() {
    if (!isNotionAiPage()) return null;
    const candidates = findCandidateRoots();
    const picked = pickBestRoot(candidates);
    const root = picked.root;
    const wrappersInRoot = root ? getTurnWrappers(root) : [];
    const wrappers = wrappersInRoot.length ? wrappersInRoot : getTurnWrappers(document);
    if (!wrappers.length) return null;

    const messages = [];
    const warningFlags = [];

    const hasUser = wrappers.some((w) => roleFromWrapper(w) === "user");
    const hasAssistant = wrappers.some((w) => roleFromWrapper(w) === "assistant");
    if (picked.lowConfidence || !wrappersInRoot.length || root === document.body || !hasUser || !hasAssistant) {
      warningFlags.push("container_low_confidence");
    }

    for (let i = 0; i < wrappers.length; i += 1) {
      const w = wrappers[i];
      const role = roleFromWrapper(w);
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      if (!contentText) continue;
      const markdown = NS.notionAiMarkdown || {};
      const contentMarkdown = role === "user"
        ? ((typeof markdown.extractUserMarkdown === "function" ? markdown.extractUserMarkdown(w) : "") || contentText)
        : ((typeof markdown.extractAssistantMarkdown === "function" ? markdown.extractAssistantMarkdown(w) : "") || contentText);
      const userStepId = role === "user" ? w.getAttribute("data-agent-chat-user-step-id") : "";
      const firstBlockId = role === "assistant" ? (w.querySelector("div[data-block-id]") || {}).getAttribute?.("data-block-id") : "";
      const stableId = userStepId || firstBlockId || "";
      const messageKey = stableId
        ? `${role}_${stableId}`
        : NS.normalize.makeFallbackMessageKey({ role, contentText, sequence: i });
      messages.push({
        messageKey,
        role,
        contentText,
        contentMarkdown,
        sequence: i,
        updatedAt: Date.now()
      });
    }

    if (!messages.length) return null;

    const threadId = findChatThreadIdFromHref(location.href);
    const pageId = findPageIdFromUrl();
    const firstUser = messages.find((m) => m.role === "user");
    const firstUserSig = firstUser ? NS.normalize.fnv1a32(firstUser.contentText) : NS.normalize.fnv1a32(String(Date.now()));
    const conversationKey = threadId
      ? `notionai_t_${threadId}`
      : `notionai_${pageId || location.pathname}_${firstUserSig}`;
    const title = getChatTitleFromRoot(root || document);
    const canonicalUrl = threadId ? notionAiCanonicalChatUrl(threadId) : "";

    return {
      conversation: {
        sourceType: "chat",
        source: "notionai",
        conversationKey,
        title: title || document.title || "NotionAI",
        url: canonicalUrl || location.href,
        warningFlags,
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  NS.collectors = NS.collectors || {};
  NS.collectors.notionai = {
    capture,
    getRoot: () => pickBestRoot(findCandidateRoots()).root
  };

  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "notionai", matches, inpageMatches, collector: NS.collectors.notionai });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ...NS.collectors.notionai,
      __test: {
        matches,
        inpageMatches
      }
    };
  }
})();

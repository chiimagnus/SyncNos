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

  function hasAssistantBlocksOutsideUserStep(el, userStep) {
    if (!el || !el.querySelectorAll) return false;
    const blocks = Array.from(el.querySelectorAll("div[data-block-id]"));
    return blocks.some((b) => b && (!userStep || !userStep.contains(b)));
  }

  function isUserTurnContainer(el) {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector("[data-agent-chat-user-step-id]");
  }

  function isAssistantTurnContainer(el) {
    if (!el || !el.querySelector) return false;
    if (el.querySelector("[data-agent-chat-user-step-id]")) return false;
    return !!el.querySelector("div[data-block-id]");
  }

  function directChildContaining(root, target) {
    if (!root || !root.children || !target) return null;
    const kids = Array.from(root.children || []);
    for (const k of kids) {
      if (k && k.contains && k.contains(target)) return k;
    }
    return null;
  }

  function findTurnsListRoot(seedUserStep, boundaryRoot, totalUserStepsInBoundary) {
    if (!seedUserStep) return null;
    const total = typeof totalUserStepsInBoundary === "number" ? totalUserStepsInBoundary : 0;
    let el = seedUserStep;
    let best = null;
    let bestScore = -Infinity;

    for (let depth = 0; depth < 40 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.children) continue;

      if (boundaryRoot && el === boundaryRoot.parentElement) break;

      const children = Array.from(el.children || []);
      if (children.length < 2) continue;

      const userChildCount = children.filter(isUserTurnContainer).length;
      const assistantChildCount = children.filter(isAssistantTurnContainer).length;
      if (!userChildCount || !assistantChildCount) continue;

      // If we already see multiple turns, avoid choosing a container that only has a single user child
      // (often indicates a broader layout container that also contains sidebar/page content).
      if (total >= 2 && userChildCount < 2) continue;

      const paired = Math.min(userChildCount, assistantChildCount);
      const balance = 1 - Math.abs(userChildCount - assistantChildCount) / Math.max(1, userChildCount + assistantChildCount);
      const density = (userChildCount + assistantChildCount) / Math.max(1, children.length);

      const score = paired * 100000 + Math.round(balance * 10000) + Math.round(density * 1000) - depth * 10 - children.length;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }

      if (boundaryRoot && el === boundaryRoot) break;
    }

    return best;
  }

  function findNextAssistantContainerFromUserItem(userItem, listRoot) {
    if (!userItem) return null;
    let sib = userItem.nextElementSibling;
    while (sib && (!listRoot || listRoot.contains(sib))) {
      if (isUserTurnContainer(sib)) return null;
      if (isAssistantTurnContainer(sib)) return sib;
      sib = sib.nextElementSibling;
    }
    return null;
  }

  function findTupleAndAssistantByChildren(userStep) {
    if (!userStep) return { tuple: null, assistantWrapper: null };
    let el = userStep;

    for (let depth = 0; depth < 40 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.children) continue;

      const userSteps = el.querySelectorAll ? el.querySelectorAll("[data-agent-chat-user-step-id]") : [];
      if (!userSteps || userSteps.length !== 1 || userSteps[0] !== userStep) continue;

      const children = Array.from(el.children || []);
      if (children.length < 2) continue;

      const userChild = children.find((c) => c && c.contains && c.contains(userStep));
      if (!userChild) continue;

      const assistantChild = children.find((c) => {
        if (!c || c === userChild || !c.querySelector) return false;
        if (c.querySelector("[data-agent-chat-user-step-id]")) return false;
        return hasAssistantBlocksOutsideUserStep(c, null);
      });

      if (assistantChild) return { tuple: el, assistantWrapper: assistantChild };
    }

    return { tuple: null, assistantWrapper: null };
  }

  function findMessageTupleFromUserStep(userStep, scope) {
    if (!userStep || !userStep.parentElement) return null;
    const s = scope || document;
    let bestFallback = null;
    let el = userStep;

    for (let depth = 0; depth < 30 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.querySelectorAll) continue;
      if (s !== document && !s.contains(el)) break;

      const steps = el.querySelectorAll("[data-agent-chat-user-step-id]");
      if (steps.length !== 1 || steps[0] !== userStep) continue;

      if (el.classList && el.classList.contains("autolayout-col") && el.classList.contains("autolayout-fill-width")) {
        bestFallback = el;
      }

      const assistantBlocks = Array.from(el.querySelectorAll("div[data-block-id]")).filter((b) => b && !userStep.contains(b));
      if (assistantBlocks.length) return el;
    }

    return bestFallback;
  }

  function findAssistantWrapperFromTuple(tupleEl, userStep) {
    if (!tupleEl || !tupleEl.querySelectorAll) return null;
    const blocks = Array.from(tupleEl.querySelectorAll("div[data-block-id]")).filter((b) => b && (!userStep || !userStep.contains(b)));
    if (!blocks.length) return null;

    const firstBlock = blocks[0];
    let w =
      firstBlock.closest("div[data-content-editable-root='true']") ||
      firstBlock.closest(".autolayout-col.autolayout-fill-width") ||
      firstBlock.closest("div");

    while (w && w !== tupleEl && userStep && w.contains(userStep)) w = w.parentElement;
    if (!w || (userStep && w.contains(userStep)) || !tupleEl.contains(w)) {
      w = firstBlock.parentElement;
      while (w && w !== tupleEl && userStep && w.contains(userStep)) w = w.parentElement;
    }

    if (!w || !tupleEl.contains(w) || (userStep && w.contains(userStep))) return null;
    return w;
  }

  function getTurnWrappers(root) {
    const uniqueNodes = new Set();
    const scope = root || document;
    const userSteps = Array.from(scope.querySelectorAll("[data-agent-chat-user-step-id]"));
    if (!userSteps.length) return [];

    const listRoot = findTurnsListRoot(userSteps[0], scope === document ? null : scope, userSteps.length);
    if (listRoot) {
      const inListSteps = Array.from(listRoot.querySelectorAll("[data-agent-chat-user-step-id]"));
      for (const step of inListSteps) {
        const userItem = directChildContaining(listRoot, step);
        const assistantItem = userItem ? findNextAssistantContainerFromUserItem(userItem, listRoot) : null;
        uniqueNodes.add(step);
        if (assistantItem) uniqueNodes.add(assistantItem);
      }
    } else {
    for (const userStep of userSteps) {
      // Important: tuple/assistant may render outside the chosen scroll container.
      // Still anchor on user steps within `scope` to avoid capturing sidebar/page blocks.
      const byChildren = findTupleAndAssistantByChildren(userStep);
      const tuple = byChildren.tuple || findMessageTupleFromUserStep(userStep, document) || null;
      const assistantWrapper = byChildren.assistantWrapper || (tuple ? findAssistantWrapperFromTuple(tuple, userStep) : null);
      uniqueNodes.add(userStep);
      if (assistantWrapper) uniqueNodes.add(assistantWrapper);
    }
    }

    const finalNodes = [];
    for (const node of Array.from(uniqueNodes)) {
      const isChild = finalNodes.some((parent) => parent.contains(node));
      if (!isChild) finalNodes.push(node);
    }

    finalNodes.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return finalNodes;
  }

  function roleFromWrapper(wrapper) {
    if (!wrapper) return "";
    if (wrapper.getAttribute && wrapper.getAttribute("data-agent-chat-user-step-id")) return "user";
    if (wrapper.querySelector && wrapper.querySelector("div[data-block-id]")) return "assistant";
    return "";
  }

  function isTopLevelBlock(block, scope) {
    if (!block) return false;
    if (!scope) return true;
    let p = block && block.parentElement ? block.parentElement : null;
    while (p && p !== scope) {
      if (p.getAttribute && p.getAttribute("data-block-id")) return false;
      p = p.parentElement;
    }
    return true;
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
    // Observed DOM (see `Extensions/WebClipper/src/collectors/notionai/notionai.md`):
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
    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;

    function mergeImageUrls(nodes) {
      if (!extractImages) return [];
      const set = new Set();
      for (const n of nodes || []) {
        const urls = extractImages(n);
        for (const u of urls || []) set.add(u);
      }
      return Array.from(set);
    }

    function isThreadAttachmentImageUrl(url) {
      const u = String(url || "").trim();
      if (!u) return false;
      // NotionAI user uploaded images often appear as:
      // https://www.notion.so/image/attachment%3A...png?table=thread&id=...&...
      if (!/^https?:\/\/[^/]*notion\.so\//i.test(u)) return false;
      if (!/\/image\/attachment%3a/i.test(u)) return false;
      if (!/[?&]table=thread(?:[&#]|$)/i.test(u)) return false;
      if (!/[?&]id=[0-9a-f-]{16,}/i.test(u)) return false;
      return true;
    }

    function findUserAttachmentContainer(userWrapper) {
      let el = userWrapper;
      for (let depth = 0; depth < 12 && el; depth += 1) {
        try {
          if (el.querySelectorAll) {
            const userSteps = el.querySelectorAll("[data-agent-chat-user-step-id]");
            if (userSteps.length === 1 && userSteps[0] === userWrapper) {
              const imgs = Array.from(el.querySelectorAll("img"));
              const hasAttachmentLike = imgs.some((img) => {
                const src = img && img.src ? String(img.src) : "";
                return /\/image\/attachment%3a/i.test(src) && /[?&]table=thread/i.test(src);
              });
              if (hasAttachmentLike) return el;
            }
          }
        } catch (_e) {
          // ignore
        }
        el = el.parentElement;
      }
      return userWrapper;
    }

    const hasUser = wrappers.some((w) => roleFromWrapper(w) === "user");
    const hasAssistant = wrappers.some((w) => roleFromWrapper(w) === "assistant");
    if (picked.lowConfidence || !wrappersInRoot.length || root === document.body || !hasUser || !hasAssistant) {
      warningFlags.push("container_low_confidence");
    }

    for (let i = 0; i < wrappers.length; i += 1) {
      const w = wrappers[i];
      const role = roleFromWrapper(w);
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      const imageUrls = (() => {
        if (!w || !w.querySelector) return [];
        if (role === "assistant") {
          const blocks = Array.from(w.querySelectorAll("div[data-block-id]"));
          return mergeImageUrls(blocks.length ? blocks : [w]);
        }

        const leaf =
          w.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
          w.querySelector("[data-content-editable-leaf='true']") ||
          w;

        const attachmentContainer = findUserAttachmentContainer(w);
        const merged = mergeImageUrls([leaf, attachmentContainer]);
        return merged.filter(isThreadAttachmentImageUrl);
      })();
      if (!contentText && !imageUrls.length) continue;
      const markdown = NS.notionAiMarkdown || {};
      const contentMarkdown = role === "user"
        ? ((typeof markdown.extractUserMarkdown === "function" ? markdown.extractUserMarkdown(w) : "") || contentText)
        : ((typeof markdown.extractAssistantMarkdown === "function" ? markdown.extractAssistantMarkdown(w) : "") || contentText);
      const nextMarkdown = appendImageMd ? appendImageMd(contentMarkdown || contentText || "", imageUrls) : (contentMarkdown || contentText || "");
      const userStepId = role === "user" ? w.getAttribute("data-agent-chat-user-step-id") : "";
      const firstBlockId = role === "assistant" ? (w.querySelector("div[data-block-id]") || {}).getAttribute?.("data-block-id") : "";
      const stableId = userStepId || firstBlockId || "";
      const messageKey = stableId
        ? `${role}_${stableId}`
        : NS.normalize.makeFallbackMessageKey({ role, contentText: contentText || "", sequence: i });
      messages.push({
        messageKey,
        role,
        contentText: contentText || "",
        contentMarkdown: nextMarkdown,
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

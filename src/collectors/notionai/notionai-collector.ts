import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import { appendImageMarkdown, extractImageUrlsFromElement } from '@collectors/collector-utils.ts';
import notionAiMarkdown from '@collectors/notionai/notionai-markdown.ts';
import { markdownToSemanticText } from '@services/shared/markdown-semantic-text';

export function createNotionAiCollectorDef(env: CollectorEnv): CollectorDefinition {
  const window = env.window;
  const document = env.document;
  const location = env.location;

  const NOTION_AI_CHAT_CHROME_SELECTOR =
    '[data-testid="agent-send-message-button"], [data-testid="unified-chat-model-button"]';
  const NOTION_AI_COMPOSER_LEAF_SELECTOR =
    'div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]';
  const NOTION_AI_HISTORY_SELECTOR = 'div[role="button"][aria-label="history"]';

  function isNotionWebHost(hostname: unknown): boolean {
    const host = String(hostname || '')
      .trim()
      .toLowerCase();
    if (!host) return false;
    return (
      host === 'notion.so' ||
      host.endsWith('.notion.so') ||
      host === 'app.notion.com' ||
      host.endsWith('.app.notion.com')
    );
  }

  function findChatThreadIdFromHref(href: any): any {
    try {
      const u = new URL(String(href || location.href || ''));
      const t = String(u.searchParams.get('t') || '').trim();
      if (/^[0-9a-fA-F]{32}$/.test(t)) return t.toLowerCase();
      const hash = String(u.hash || '').replace(/^#/, '');
      const m = hash.match(/(?:^|[?&])t=([0-9a-fA-F]{32})(?:[&#]|$)/);
      return m ? String(m[1]).toLowerCase() : '';
    } catch (_e) {
      return '';
    }
  }

  function notionAiCanonicalChatUrl(threadId: any): any {
    if (!threadId) return '';
    return `https://app.notion.com/chat?t=${threadId}&wfv=chat`;
  }

  function hasChatSignals(scope: any): any {
    const s = scope || document;
    // NotionAI chat turns include this marker on user messages (observed across page/side-panel/floating dialog).
    return !!s.querySelector('[data-agent-chat-user-step-id]');
  }

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    if (!isNotionWebHost(hostname)) return false;
    // Important: do not activate on normal Notion pages, otherwise we can capture page blocks as "assistant" turns.
    return hasChatSignals(document);
  }

  function inpageMatches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    // UI eligibility: show the inpage button on Notion pages even before chat turns render.
    // Actual capture is still guarded by `isNotionAiPage()`.
    return isNotionWebHost(hostname);
  }

  function isNotionAiPage(): any {
    return isNotionWebHost(location.hostname) && hasChatSignals(document);
  }

  function getAnyUserStepEl(scope?: any): any {
    return (scope || document).querySelector('[data-agent-chat-user-step-id]');
  }

  function getLastUserStepEl(scope?: any): any {
    const steps: any[] = Array.from((scope || document).querySelectorAll('[data-agent-chat-user-step-id]')) as any[];
    return steps.length ? steps[steps.length - 1] : null;
  }

  function findChatBoundaryRootFromUserStep(userStep: any): any {
    if (!userStep) return null;
    let el = userStep;
    for (let depth = 0; depth < 60 && el; depth += 1) {
      try {
        if (
          el.querySelector?.('[data-agent-chat-user-step-id]') &&
          el.querySelector?.(NOTION_AI_CHAT_CHROME_SELECTOR)
        ) {
          return el;
        }
      } catch (_e) {
        // ignore
      }
      el = el.parentElement;
    }
    return null;
  }

  function findScrollContainerFromSeed(seed: any): any {
    if (!seed) return null;
    let el = seed.parentElement;
    for (let i = 0; i < 20 && el; i += 1) {
      try {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY || '';
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 20) {
          return el;
        }
      } catch (_e) {
        // ignore
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function findScrollContainer(): any {
    return findScrollContainerFromSeed(getLastUserStepEl() || getAnyUserStepEl());
  }

  function isVisible(el: any): any {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return false;
    if (r.bottom < 0 || r.right < 0) return false;
    if (r.top > window.innerHeight || r.left > window.innerWidth) return false;
    return true;
  }

  function rectVisibleArea(r: any): any {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return w * h;
  }

  function findCandidateRoots(): any {
    const allSteps: any[] = Array.from(document.querySelectorAll('[data-agent-chat-user-step-id]')) as any[];
    const seeds: any[] = allSteps.slice(Math.max(0, allSteps.length - 20)) as any[];
    if (!seeds.length) return [];
    const set = new Set();
    for (const s of seeds) {
      const root = findScrollContainerFromSeed(s);
      if (root) set.add(root);
    }
    const roots: any[] = Array.from(set).filter(isVisible) as any[];
    if (!roots.length) {
      const fallback = findScrollContainer();
      if (fallback) roots.push(fallback);
    }
    return roots;
  }

  function rootScore(root: any): any {
    if (!root) return -Infinity;
    const userCount = root.querySelectorAll('[data-agent-chat-user-step-id]').length;
    const blockCount = root.querySelectorAll('div[data-block-id]').length;
    const rect = root.getBoundingClientRect ? root.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
    const area = rectVisibleArea(rect);
    // Prefer containers with many user turns but fewer generic Notion blocks (reduce capturing page content).
    return userCount * 100000 - blockCount * 10 + area / 1000;
  }

  function pickBestRoot(roots: any): any {
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
    const userCount = best ? best.querySelectorAll('[data-agent-chat-user-step-id]').length : 0;
    return { root: best, allRoots: roots, lowConfidence: roots.length !== 1 || userCount < 1 };
  }

  function hasAssistantBlocksOutsideUserStep(el: any, userStep: any): any {
    if (!el || !el.querySelectorAll) return false;
    const blocks: any[] = Array.from(el.querySelectorAll('div[data-block-id]')) as any[];
    return blocks.some((b) => b && (!userStep || !userStep.contains(b)));
  }

  function isComposerLeaf(el: any): any {
    return !!el?.matches?.(NOTION_AI_COMPOSER_LEAF_SELECTOR);
  }

  function containsComposerLeaf(el: any): any {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector(NOTION_AI_COMPOSER_LEAF_SELECTOR);
  }

  function containsChatChrome(el: any): any {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector(`${NOTION_AI_CHAT_CHROME_SELECTOR}, ${NOTION_AI_HISTORY_SELECTOR}`);
  }

  function findUserTextLeaf(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return null;
    return (
      wrapper.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
      wrapper.querySelector("[data-content-editable-leaf='true']") ||
      null
    );
  }

  function directAssistantBlockCount(el: any): any {
    if (!el || !el.children) return 0;
    return Array.from(el.children || []).filter((child: any) => child?.getAttribute?.('data-block-id')).length;
  }

  function isUserTurnContainer(el: any): any {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector('[data-agent-chat-user-step-id]');
  }

  function isAssistantTurnContainer(el: any): any {
    if (!el || !el.querySelector) return false;
    if (el.querySelector('[data-agent-chat-user-step-id]')) return false;
    return !!el.querySelector('div[data-block-id]');
  }

  function directChildContaining(root: any, target: any): any {
    if (!root || !root.children || !target) return null;
    const kids: any[] = Array.from(root.children || []) as any[];
    for (const k of kids) {
      if (k && k.contains && k.contains(target)) return k;
    }
    return null;
  }

  function findTurnsListRoot(seedUserStep: any, boundaryRoot: any, totalUserStepsInBoundary: any): any {
    if (!seedUserStep) return null;
    const total = typeof totalUserStepsInBoundary === 'number' ? totalUserStepsInBoundary : 0;
    let el = seedUserStep;
    let best = null;
    let bestScore = -Infinity;

    for (let depth = 0; depth < 40 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.children) continue;

      if (boundaryRoot && el === boundaryRoot.parentElement) break;

      const children: any[] = Array.from(el.children || []) as any[];
      if (children.length < 2) continue;

      const userChildCount = children.filter(isUserTurnContainer).length;
      const assistantChildCount = children.filter(isAssistantTurnContainer).length;
      if (!userChildCount || !assistantChildCount) continue;

      const paired = Math.min(userChildCount, assistantChildCount);
      const balance =
        1 - Math.abs(userChildCount - assistantChildCount) / Math.max(1, userChildCount + assistantChildCount);
      const density = (userChildCount + assistantChildCount) / Math.max(1, children.length);

      // In virtualized chat history, a tight sub-root can legitimately contain just one marker user
      // plus its assistant sibling. Reject only broad sparse containers, not dense two-item mini roots.
      if (total >= 2 && userChildCount < 2 && density < 0.6) continue;

      const score =
        paired * 100000 + Math.round(balance * 10000) + Math.round(density * 1000) - depth * 10 - children.length;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }

      if (boundaryRoot && el === boundaryRoot) break;
    }

    return best;
  }

  function findNextAssistantContainerFromUserItem(userItem: any, listRoot: any): any {
    if (!userItem) return null;
    let sib = userItem.nextElementSibling;
    while (sib && (!listRoot || listRoot.contains(sib))) {
      if (isUserTurnContainer(sib)) return null;
      if (isAssistantTurnContainer(sib)) return sib;
      sib = sib.nextElementSibling;
    }
    return null;
  }

  function findTupleAndAssistantByChildren(userStep: any, boundaryRoot?: any): any {
    if (!userStep) return { tuple: null, assistantWrapper: null };
    let el = userStep;

    for (let depth = 0; depth < 40 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.children) continue;
      if (boundaryRoot && el === boundaryRoot.parentElement) break;

      const userSteps = el.querySelectorAll ? el.querySelectorAll('[data-agent-chat-user-step-id]') : [];
      if (!userSteps || userSteps.length !== 1 || userSteps[0] !== userStep) continue;

      const children: any[] = Array.from(el.children || []) as any[];
      if (children.length < 2) continue;

      const userChild = children.find((c: any) => c && c.contains && c.contains(userStep));
      if (!userChild) continue;

      const assistantChild = children.find((c: any) => {
        if (!c || c === userChild || !c.querySelector) return false;
        if (c.querySelector('[data-agent-chat-user-step-id]')) return false;
        return hasAssistantBlocksOutsideUserStep(c, null);
      });

      if (assistantChild) return { tuple: el, assistantWrapper: assistantChild };
    }

    return { tuple: null, assistantWrapper: null };
  }

  function findMessageTupleFromUserStep(userStep: any, scope: any): any {
    if (!userStep || !userStep.parentElement) return null;
    const s = scope || document;
    let bestFallback = null;
    let el = userStep;

    for (let depth = 0; depth < 30 && el && el.parentElement; depth += 1) {
      el = el.parentElement;
      if (!el || !el.querySelectorAll) continue;
      if (s !== document && !s.contains(el)) break;

      const steps = el.querySelectorAll('[data-agent-chat-user-step-id]');
      if (steps.length !== 1 || steps[0] !== userStep) continue;

      if (el.classList && el.classList.contains('autolayout-col') && el.classList.contains('autolayout-fill-width')) {
        bestFallback = el;
      }

      const assistantBlocks: any[] = Array.from(el.querySelectorAll('div[data-block-id]')).filter(
        (b: any) => b && !userStep.contains(b),
      ) as any[];
      if (assistantBlocks.length) return el;
    }

    return bestFallback;
  }

  function findAssistantWrapperFromTuple(tupleEl: any, userStep: any): any {
    if (!tupleEl || !tupleEl.querySelectorAll) return null;
    const blocks: any[] = Array.from(tupleEl.querySelectorAll('div[data-block-id]')).filter(
      (b: any) => b && (!userStep || !userStep.contains(b)),
    ) as any[];
    if (!blocks.length) return null;

    const firstBlock = blocks[0];
    let w =
      firstBlock.closest("div[data-content-editable-root='true']") ||
      firstBlock.closest('.autolayout-col.autolayout-fill-width') ||
      firstBlock.closest('div');

    while (w && w !== tupleEl && userStep && w.contains(userStep)) w = w.parentElement;
    if (!w || (userStep && w.contains(userStep)) || !tupleEl.contains(w)) {
      w = firstBlock.parentElement;
      while (w && w !== tupleEl && userStep && w.contains(userStep)) w = w.parentElement;
    }

    if (!w || !tupleEl.contains(w) || (userStep && w.contains(userStep))) return null;
    return w;
  }

  function scoreFallbackUserContainer(el: any): any {
    if (!el || !el.querySelector) return -Infinity;
    if (el.querySelector('[data-agent-chat-user-step-id]')) return -Infinity;
    if (containsComposerLeaf(el)) return -Infinity;
    if (containsChatChrome(el)) return -Infinity;
    if (el.querySelector('div[data-block-id]')) return -Infinity;
    if (el.getAttribute?.('data-block-id')) return -Infinity;
    const leaf = findUserTextLeaf(el);
    if (!leaf || isComposerLeaf(leaf)) return -Infinity;
    const text = env.normalize.normalizeText((leaf as any).innerText || leaf.textContent || '');
    if (!text) return -Infinity;

    let score = 0;
    if (leaf.closest?.('div[style*="border-radius: 16px"]')) score += 1000;
    if (leaf !== el) score += 200;
    if (directAssistantBlockCount(el) === 0) score += 100;
    if (text.length <= 1200) score += 50;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (rect && rect.width > 40 && rect.width < Math.max(220, window.innerWidth * 0.9)) score += 40;
    if (rect && rect.height > 12 && rect.height < Math.max(400, window.innerHeight * 0.8)) score += 20;
    return score;
  }

  function pickFallbackUserWrapperFromItem(item: any): any {
    if (!item || !item.querySelectorAll) return null;
    if (item.querySelector('[data-agent-chat-user-step-id]')) return null;
    const candidates: any[] = [item, ...Array.from(item.querySelectorAll('div'))];
    let best: any = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = scoreFallbackUserContainer(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return bestScore >= 1000 ? best : null;
  }

  function buildTurnEntriesFromListRoot(listRoot: any): any[] {
    if (!listRoot || !listRoot.children) return [];
    const entries: any[] = [];
    const seen = new Set<any>();
    const pushEntry = (wrapper: any, role: 'user' | 'assistant', kind: 'marker' | 'fallback') => {
      if (!wrapper || seen.has(wrapper)) return;
      seen.add(wrapper);
      entries.push({ wrapper, role, kind });
    };

    const items: any[] = Array.from(listRoot.children || []) as any[];
    for (const item of items) {
      if (!item) continue;
      const userStep = item.matches?.('[data-agent-chat-user-step-id]')
        ? item
        : item.querySelector?.('[data-agent-chat-user-step-id]');
      if (userStep) {
        pushEntry(userStep, 'user', 'marker');
        continue;
      }

      if (isAssistantTurnContainer(item)) {
        pushEntry(item, 'assistant', 'marker');
        continue;
      }

      const fallbackUser = pickFallbackUserWrapperFromItem(item);
      if (fallbackUser) {
        pushEntry(fallbackUser, 'user', 'fallback');
      }
    }

    return entries;
  }

  function compareDomOrder(a: any, b: any): number {
    if (!a || !b || a === b) return 0;
    const pos = a.compareDocumentPosition?.(b) || 0;
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function findTurnsListRoots(userSteps: any[], boundaryRoot: any, totalUserStepsInBoundary: any): any[] {
    const roots: any[] = [];
    const seen = new Set<any>();
    for (const userStep of userSteps || []) {
      const candidate = findTurnsListRoot(userStep, boundaryRoot, totalUserStepsInBoundary);
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      roots.push(candidate);
    }
    roots.sort(compareDomOrder);
    return roots;
  }

  function getTurnWrappers(root: any): any {
    const scope = root || document;
    const initialUserSteps: any[] = Array.from(scope.querySelectorAll('[data-agent-chat-user-step-id]')) as any[];
    if (!initialUserSteps.length) return [];

    const boundaryScope =
      scope === document ? findChatBoundaryRootFromUserStep(initialUserSteps[initialUserSteps.length - 1]) : null;
    const effectiveScope = boundaryScope && boundaryScope.querySelector ? boundaryScope : scope;
    const userSteps: any[] = Array.from(effectiveScope.querySelectorAll('[data-agent-chat-user-step-id]')) as any[];
    if (!userSteps.length) return [];

    const ordered: any[] = [];
    const seen = new Set<any>();
    const pushUnique = (node: any) => {
      const identity = node?.wrapper || node;
      if (!identity || seen.has(identity)) return;
      seen.add(identity);
      ordered.push(node);
    };

    // Important: Notion AI chat UIs may render "user" and "assistant" DOM nodes in different subtrees (or reorder them),
    // so the raw DOM order is not a reliable proxy for conversation order. We anchor on user steps (which are ordered)
    // and then attach their corresponding assistant wrappers, preserving the intended `user -> assistant` alternation.
    //
    // Also, Notion may virtualize chat history into multiple list containers. A single inferred "list root" can miss
    // newly appended turns. We still try to use a list root when it helps pairing, but we always iterate all user steps
    // to guarantee coverage.
    const boundaryRoot = effectiveScope === document ? null : effectiveScope;
    const totalUserStepsInBoundary = boundaryRoot
      ? boundaryRoot.querySelectorAll('[data-agent-chat-user-step-id]').length
      : userSteps.length;
    const listRoots = findTurnsListRoots(userSteps, boundaryRoot, totalUserStepsInBoundary);
    const listRoot = listRoots[0] || null;

    const directEntries: any[] = [];
    const directSeen = new Set<any>();
    let markerUserCoverage = 0;
    for (const candidateRoot of listRoots) {
      markerUserCoverage += candidateRoot?.querySelectorAll?.('[data-agent-chat-user-step-id]').length || 0;
      for (const entry of buildTurnEntriesFromListRoot(candidateRoot)) {
        const identity = entry?.wrapper || entry;
        if (!identity || directSeen.has(identity)) continue;
        directSeen.add(identity);
        directEntries.push(entry);
      }
    }
    directEntries.sort((a: any, b: any) => compareDomOrder(a?.wrapper || a, b?.wrapper || b));

    if (directEntries.length) {
      const userCount = directEntries.filter((entry: any) => entry.role === 'user').length;
      const assistantCount = directEntries.filter((entry: any) => entry.role === 'assistant').length;
      if (userCount && assistantCount && markerUserCoverage >= userSteps.length) return directEntries;
    }

    for (const userStep of userSteps) {
      pushUnique({ wrapper: userStep, role: 'user', kind: 'marker' });

      let assistantWrapper: any = null;
      if (listRoot && listRoot.contains && listRoot.contains(userStep)) {
        const userItem = directChildContaining(listRoot, userStep);
        assistantWrapper = userItem ? findNextAssistantContainerFromUserItem(userItem, listRoot) : null;
      }

      if (!assistantWrapper) {
        const byChildren = findTupleAndAssistantByChildren(userStep, boundaryRoot || null);
        const tuple = byChildren.tuple || findMessageTupleFromUserStep(userStep, effectiveScope) || null;
        assistantWrapper =
          byChildren.assistantWrapper || (tuple ? findAssistantWrapperFromTuple(tuple, userStep) : null);
      }

      if (assistantWrapper) pushUnique({ wrapper: assistantWrapper, role: 'assistant', kind: 'marker' });
    }

    return ordered;
  }

  function roleFromWrapper(wrapper: any): any {
    if (!wrapper) return '';
    if (wrapper.role === 'user' || wrapper.role === 'assistant') return wrapper.role;
    const target = wrapper.wrapper || wrapper;
    if (target.getAttribute && target.getAttribute('data-agent-chat-user-step-id')) return 'user';
    if (target.querySelector && target.querySelector('div[data-block-id]')) return 'assistant';
    return '';
  }

  function isTopLevelBlock(block: any, scope: any): any {
    if (!block) return false;
    if (!scope) return true;
    let p = block && block.parentElement ? block.parentElement : null;
    while (p && p !== scope) {
      if (p.getAttribute && p.getAttribute('data-block-id')) return false;
      p = p.parentElement;
    }
    return true;
  }

  function extractUserText(wrapper: any): any {
    const target = wrapper?.wrapper || wrapper;
    const leaf = findUserTextLeaf(target);
    const raw = leaf
      ? (leaf as any).innerText || leaf.textContent || ''
      : (target as any).innerText || target.textContent || '';
    return env.normalize.normalizeText(raw);
  }

  function extractAssistantText(wrapper: any): any {
    const target = wrapper?.wrapper || wrapper;
    const blocks: any[] = Array.from(target.querySelectorAll('div[data-block-id]')) as any[];
    if (!blocks.length) {
      const raw = (target as any).innerText || target.textContent || '';
      return env.normalize.normalizeText(raw);
    }
    const topBlocks = blocks.filter((b: any) => isTopLevelBlock(b, target));
    const parts: any[] = [];
    for (const b of topBlocks) {
      const raw = (b as any).innerText || b.textContent || '';
      const t = env.normalize.normalizeText(raw);
      if (t) parts.push(t);
    }
    return env.normalize.normalizeText(parts.join('\n'));
  }

  function findPageIdFromUrl(): any {
    const m = location.pathname.match(/[0-9a-fA-F]{32}/);
    return m ? m[0].toLowerCase() : '';
  }

  function getChatTitleFromHistoryButton(): any {
    // Observed DOM (see `src/collectors/notionai/notionai.md`):
    // <div role="button" aria-label="history"> <div>Title...</div> ... </div>
    const btn = document.querySelector('div[role="button"][aria-label="history"]');
    if (!btn) return '';
    const titleEl = btn.firstElementChild;
    const raw = titleEl
      ? (titleEl as any).innerText || titleEl.textContent || ''
      : (btn as any).innerText || btn.textContent || '';
    const title = String(raw || '')
      .split('\n')
      .join(' ')
      .trim();
    return title ? title.slice(0, 80) : '';
  }

  function getChatTitleFromRoot(root: any): any {
    const fromHistory = getChatTitleFromHistoryButton();
    if (fromHistory) return fromHistory;

    const firstUser = getAnyUserStepEl(root) || getAnyUserStepEl(document);
    if (!firstUser) return 'NotionAI Chat';
    const leaf =
      firstUser.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
      firstUser.querySelector("[data-content-editable-leaf='true']");
    const raw = leaf
      ? (leaf as any).innerText || leaf.textContent || ''
      : (firstUser as any).innerText || firstUser.textContent || '';
    const title = String(raw || '')
      .split('\n')
      .join(' ')
      .trim()
      .slice(0, 60);
    return title || 'NotionAI Chat';
  }

  function capture(): any {
    if (!isNotionAiPage()) return null;
    const candidates = findCandidateRoots();
    const picked = pickBestRoot(candidates);
    const root = picked.root;
    const wrappersInRoot: any[] = root ? getTurnWrappers(root) : [];
    // Notion AI chat turns may render across multiple nested/portaled containers. Even when a "best" scroll
    // container is found, it can miss newly appended turns, causing auto-save to drop user messages.
    // Always derive the wrapper order from the full document so we never miss visible turns.
    const wrappersDoc: any[] = getTurnWrappers(document) || [];
    const wrappers: any[] = wrappersDoc.length ? wrappersDoc : wrappersInRoot;
    if (!wrappers.length) return null;

    const messages: any[] = [];
    const warningFlags: any[] = [];
    let lastUserStepId = '';
    const fallbackUserOccurrenceByBasis = new Map<string, number>();
    const assistantOccurrenceByReplySeed = new Map<string, number>();

    function mergeImageUrls(nodes: any): any {
      const set = new Set();
      for (const n of nodes || []) {
        const urls = extractImageUrlsFromElement(n);
        for (const u of urls || []) set.add(u);
      }
      return Array.from(set);
    }

    function isThreadAttachmentImageUrl(url: any): any {
      const u = String(url || '').trim();
      if (!u) return false;
      // NotionAI user uploaded images often appear as:
      // https://app.notion.com/image/attachment%3A...png?table=thread&id=...&...
      if (!/^https?:\/\/[^/]*(?:notion\.so|app\.notion\.com)\//i.test(u)) return false;
      if (!/\/image\/attachment%3a/i.test(u)) return false;
      if (!/[?&]table=thread(?:[&#]|$)/i.test(u)) return false;
      if (!/[?&]id=[0-9a-f-]{16,}/i.test(u)) return false;
      return true;
    }

    function findUserAttachmentContainer(userWrapper: any): any {
      let el = userWrapper;
      for (let depth = 0; depth < 12 && el; depth += 1) {
        try {
          if (el.querySelectorAll) {
            const userSteps = el.querySelectorAll('[data-agent-chat-user-step-id]');
            if (userSteps.length === 1 && userSteps[0] === userWrapper) {
              const imgs: any[] = Array.from(el.querySelectorAll('img')) as any[];
              const hasAttachmentLike = imgs.some((img) => {
                const src = img && img.src ? String(img.src) : '';
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

    const hasUser = wrappers.some((w: any) => roleFromWrapper(w) === 'user');
    const hasAssistant = wrappers.some((w: any) => roleFromWrapper(w) === 'assistant');
    if (picked.lowConfidence || !wrappersInRoot.length || root === document.body || !hasUser || !hasAssistant) {
      warningFlags.push('container_low_confidence');
    }

    for (let i = 0; i < wrappers.length; i += 1) {
      const w = wrappers[i];
      const role = roleFromWrapper(w);
      const contentText = role === 'user' ? extractUserText(w) : extractAssistantText(w);
      const imageUrls = (() => {
        const target = w?.wrapper || w;
        if (!target || !target.querySelector) return [];
        if (role === 'assistant') {
          const blocks: any[] = Array.from(target.querySelectorAll('div[data-block-id]')) as any[];
          return mergeImageUrls(blocks.length ? blocks : [target]);
        }

        const leaf = findUserTextLeaf(target) || target;

        const attachmentContainer = findUserAttachmentContainer(target);
        const merged = mergeImageUrls([leaf, attachmentContainer]);
        return merged.filter(isThreadAttachmentImageUrl);
      })();
      if (!contentText && !imageUrls.length) continue;
      const markdown: any = notionAiMarkdown as any;
      const contentMarkdown =
        role === 'user'
          ? (typeof markdown.extractUserMarkdown === 'function' ? markdown.extractUserMarkdown(w?.wrapper || w) : '') ||
            contentText
          : (typeof markdown.extractAssistantMarkdown === 'function'
              ? markdown.extractAssistantMarkdown(w?.wrapper || w)
              : '') || contentText;
      const nextMarkdown = appendImageMarkdown(contentMarkdown || contentText || '', imageUrls);
      const target = w?.wrapper || w;
      const userStepId = role === 'user' ? target.getAttribute?.('data-agent-chat-user-step-id') : '';
      const fallbackUserId =
        role === 'user' && !userStepId
          ? (() => {
              const basis = env.normalize.fnv1a32(`${contentText}\n${nextMarkdown}\n${imageUrls.join('\n')}`);
              const occurrence = (fallbackUserOccurrenceByBasis.get(String(basis)) || 0) + 1;
              fallbackUserOccurrenceByBasis.set(String(basis), occurrence);
              const key = `user_like_${basis}_${occurrence}`;
              return key;
            })()
          : '';
      const firstBlockId =
        role === 'assistant' ? (target.querySelector('div[data-block-id]') || {}).getAttribute?.('data-block-id') : '';
      const assistantReplySeed = role === 'assistant' && lastUserStepId ? `replyTo_${lastUserStepId}` : '';
      const assistantOccurrence = assistantReplySeed
        ? (assistantOccurrenceByReplySeed.get(assistantReplySeed) || 0) + 1
        : 0;
      if (assistantReplySeed) assistantOccurrenceByReplySeed.set(assistantReplySeed, assistantOccurrence);
      const stableId =
        role === 'assistant' && assistantReplySeed && firstBlockId
          ? `${assistantReplySeed}_${firstBlockId}`
          : role === 'assistant' && assistantReplySeed
            ? assistantOccurrence > 1
              ? `${assistantReplySeed}_part${assistantOccurrence}`
              : assistantReplySeed
            : userStepId || fallbackUserId || firstBlockId || '';
      const messageKey = stableId
        ? `${role}_${stableId}`
        : env.normalize.makeFallbackMessageKey({ role, text: contentText || '', sequence: i });
      if (role === 'user' && stableId) lastUserStepId = stableId;
      messages.push({
        messageKey,
        role,
        contentMarkdown: nextMarkdown,
        sequence: i,
        updatedAt: Date.now(),
      });
    }

    if (!messages.length) return null;

    const threadId = findChatThreadIdFromHref(location.href);
    const pageId = findPageIdFromUrl();
    const firstUser = messages.find((m: any) => m.role === 'user');
    const firstUserText = firstUser
      ? env.normalize.normalizeText(markdownToSemanticText(firstUser.contentMarkdown, { includeImageAlt: true }))
      : '';
    const firstUserSig = firstUserText
      ? env.normalize.fnv1a32(firstUserText)
      : env.normalize.fnv1a32(String(Date.now()));
    const firstUserStableSeed = String(firstUser?.messageKey || '').trim();
    const conversationKeySeed =
      firstUserStableSeed && !firstUserStableSeed.startsWith('fallback_') ? firstUserStableSeed : firstUserSig;
    const conversationKey = threadId
      ? `notionai_t_${threadId}`
      : `notionai_${pageId || location.pathname}_${conversationKeySeed}`;
    const title = getChatTitleFromRoot(root || document);
    const canonicalUrl = threadId ? notionAiCanonicalChatUrl(threadId) : '';

    return {
      conversation: {
        sourceType: 'chat',
        source: 'notionai',
        conversationKey,
        title: title || document.title || 'NotionAI',
        url: canonicalUrl || location.href,
        warningFlags,
      },
      messages,
    };
  }

  const collector: any = {
    capture,
    getRoot: () => {
      if (!isNotionAiPage()) return null;
      const seed = getLastUserStepEl(document) || getAnyUserStepEl(document);
      if (!seed) return null;
      const boundaryRoot = findChatBoundaryRootFromUserStep(seed);
      if (boundaryRoot) return boundaryRoot;
      const candidates = findCandidateRoots();
      const picked = pickBestRoot(candidates);
      const observedRoot = picked.root && picked.root !== document ? picked.root : null;
      return observedRoot || document.scrollingElement || document.documentElement || document.body;
    },
    __test: {
      matches,
      inpageMatches,
    },
  };

  return { id: 'notionai', matches, inpageMatches, collector };
}

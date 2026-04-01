import { tabsCreate, tabsGet, tabsMove, tabsUpdate } from '@platform/webext/tabs';
import { tabGroupsSupported, tabsGroup } from '@platform/webext/tab-groups';
import { windowsUpdate } from '@platform/webext/windows';
import {
  getChatWithTabReuseEntry,
  removeChatWithTabReuseEntry,
  setChatWithTabReuseEntry,
} from '@services/integrations/chatwith/tabgroup-store';
import { normalizePositiveInt } from '@services/shared/numbers';

type AnyTab = {
  id?: number;
  windowId?: number;
  url?: string;
  groupId?: number;
  active?: boolean;
};

export type OpenOrFocusGroupedChatTabInput = {
  platformId: string;
  articleKey: string;
  platformUrl: string;
  articleTabId?: number | null;
  articleWindowId?: number | null;
};

export type OpenOrFocusGroupedChatTabResult = {
  tabId: number | null;
  windowId: number | null;
  groupId: number | null;
  reused: boolean;
  grouped: boolean;
  degraded: boolean;
  reason: string | null;
  url: string;
};

function safeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeText(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function normalizeGroupId(value: unknown): number | null {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return Math.trunc(normalized);
}

function parseUrlHost(raw: unknown): string {
  const normalized = normalizeHttpUrl(raw);
  if (!normalized) return '';
  try {
    return String(new URL(normalized).host || '').toLowerCase();
  } catch (_e) {
    return '';
  }
}

function isUrlHostMatched(tabUrl: unknown, platformUrl: unknown): boolean {
  const tabHost = parseUrlHost(tabUrl);
  const platformHost = parseUrlHost(platformUrl);
  if (!tabHost || !platformHost) return false;
  return tabHost === platformHost;
}

async function safeTabsGet(tabId: number | null): Promise<AnyTab | null> {
  if (!tabId) return null;
  try {
    const tab = await tabsGet(tabId);
    return (tab as AnyTab) || null;
  } catch (_e) {
    return null;
  }
}

function pickMovedTab(moved: AnyTab[] | null | undefined, tabId: number): AnyTab | null {
  const list = Array.isArray(moved) ? moved : [];
  for (const item of list) {
    if (normalizePositiveInt(item?.id) === tabId) return item;
  }
  return list[0] || null;
}

async function moveTabToWindow(tabId: number, targetWindowId: number): Promise<AnyTab | null> {
  try {
    const moved = await tabsMove(tabId, {
      windowId: targetWindowId,
      index: -1,
    });
    const candidate = pickMovedTab(moved as AnyTab[], tabId);
    if (candidate) return candidate;
  } catch (_e) {
    return null;
  }
  return await safeTabsGet(tabId);
}

async function focusTabAndWindow(tab: AnyTab | null, fallbackWindowId: number | null): Promise<void> {
  const tabId = normalizePositiveInt(tab?.id);
  if (tabId) {
    try {
      await tabsUpdate(tabId, { active: true });
    } catch (_e) {
      // ignore
    }
  }

  const windowId = normalizePositiveInt(tab?.windowId) || fallbackWindowId;
  if (windowId) {
    try {
      await windowsUpdate(windowId, { focused: true });
    } catch (_e) {
      // ignore
    }
  }
}

export async function openOrFocusGroupedChatTab(
  input: OpenOrFocusGroupedChatTabInput,
): Promise<OpenOrFocusGroupedChatTabResult> {
  const platformId = safeText(input?.platformId).toLowerCase();
  const articleKey = safeText(input?.articleKey);
  const platformUrl = normalizeHttpUrl(input?.platformUrl);

  if (!platformId) throw new Error('invalid platformId');
  if (!articleKey) throw new Error('invalid articleKey');
  if (!platformUrl) throw new Error('invalid platformUrl');

  const articleTabId = normalizePositiveInt(input?.articleTabId);
  const requestedWindowId = normalizePositiveInt(input?.articleWindowId);
  const articleTab = await safeTabsGet(articleTabId);
  const articleWindowId = normalizePositiveInt(articleTab?.windowId) || requestedWindowId || null;

  let reason: string | null = null;
  let reused = false;
  let grouped = false;
  let degraded = false;
  let groupId: number | null = null;

  let aiTab: AnyTab | null = null;

  const stored = await getChatWithTabReuseEntry({ platformId, articleKey });
  const storedTabId = normalizePositiveInt(stored?.aiTabId);
  if (storedTabId) {
    const existingTab = await safeTabsGet(storedTabId);
    if (!existingTab || !isUrlHostMatched(existingTab.url, platformUrl)) {
      await removeChatWithTabReuseEntry({ platformId, articleKey });
    } else {
      aiTab = existingTab;
      reused = true;
    }
  }

  const aiTabIdBeforeMove = normalizePositiveInt(aiTab?.id);
  if (aiTabIdBeforeMove && articleWindowId && normalizePositiveInt(aiTab?.windowId) !== articleWindowId) {
    const moved = await moveTabToWindow(aiTabIdBeforeMove, articleWindowId);
    if (moved) {
      aiTab = moved;
    } else {
      aiTab = null;
      reused = false;
      degraded = true;
      reason = 'recreate_after_move_failed';
    }
  }

  if (!aiTab) {
    const createInput: Record<string, unknown> = {
      url: platformUrl,
      active: true,
    };
    if (articleWindowId) createInput.windowId = articleWindowId;

    aiTab = (await tabsCreate(createInput)) as AnyTab;
    reused = false;
  }

  const aiTabId = normalizePositiveInt(aiTab?.id);
  if (!aiTabId) {
    throw new Error(`failed to open platform: ${platformId}`);
  }

  await setChatWithTabReuseEntry({
    platformId,
    articleKey,
    aiTabId,
    updatedAt: Date.now(),
  });

  if (!articleTabId || !articleTab) {
    degraded = true;
    reason = reason || 'article_tab_unavailable';
  } else if (!tabGroupsSupported()) {
    degraded = true;
    reason = reason || 'tabgroups_unavailable';
  } else {
    try {
      let groupTargetTab = aiTab;
      if (articleWindowId && normalizePositiveInt(groupTargetTab?.windowId) !== articleWindowId) {
        const moved = await moveTabToWindow(aiTabId, articleWindowId);
        if (moved) {
          groupTargetTab = moved;
          aiTab = moved;
          await setChatWithTabReuseEntry({
            platformId,
            articleKey,
            aiTabId,
            updatedAt: Date.now(),
          });
        }
      }

      const currentArticleGroupId = normalizeGroupId(articleTab?.groupId);
      if (currentArticleGroupId != null) {
        groupId = await tabsGroup({
          tabIds: [aiTabId],
          groupId: currentArticleGroupId,
        });
      } else if (articleWindowId) {
        groupId = await tabsGroup({
          tabIds: [articleTabId, aiTabId],
          createProperties: { windowId: articleWindowId },
        });
      } else {
        groupId = await tabsGroup({
          tabIds: [articleTabId, aiTabId],
        });
      }
      grouped = normalizeGroupId(groupId) != null;
      if (!grouped) {
        degraded = true;
        reason = reason || 'tabgroup_unavailable';
      }
    } catch (_e) {
      degraded = true;
      reason = reason || 'tabgroup_failed';
    }
  }

  await focusTabAndWindow(aiTab, articleWindowId);

  const windowId = normalizePositiveInt(aiTab?.windowId) || articleWindowId || null;
  return {
    tabId: aiTabId,
    windowId,
    groupId: normalizeGroupId(groupId),
    reused,
    grouped,
    degraded,
    reason,
    url: platformUrl,
  };
}

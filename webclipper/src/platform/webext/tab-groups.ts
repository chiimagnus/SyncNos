import { webextApis, webextError, webextLastErrorMessage } from '@platform/webext/base';

function normalizeTabIds(input: number[] | number): number[] {
  const ids = Array.isArray(input) ? input : [input];
  const out: number[] = [];
  for (const id of ids) {
    const value = Number(id);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push(Math.floor(value));
  }
  return out;
}

export function tabGroupsSupported(): boolean {
  const { chrome, browser } = webextApis();
  if (typeof browser?.tabs?.group === 'function') return true;
  if (typeof chrome?.tabs?.group === 'function') return true;
  return false;
}

export async function tabsGroup(input: {
  tabIds: number[] | number;
  groupId?: number;
  createProperties?: { windowId?: number } | null;
}): Promise<number | null> {
  const tabIds = normalizeTabIds(input?.tabIds || []);
  if (!tabIds.length) return null;

  const groupId = Number(input?.groupId);
  const windowId = Number((input?.createProperties || {})?.windowId);
  const payload: Record<string, unknown> = {
    tabIds,
  };
  if (Number.isFinite(groupId) && groupId >= 0) payload.groupId = Math.floor(groupId);
  if (Number.isFinite(windowId) && windowId > 0) payload.createProperties = { windowId: Math.floor(windowId) };

  const { chrome, browser } = webextApis();

  if (browser?.tabs?.group) {
    const nextGroupId = await Promise.resolve(browser.tabs.group(payload as any));
    const normalized = Number(nextGroupId);
    return Number.isFinite(normalized) ? normalized : null;
  }

  if (chrome?.tabs?.group) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.group(payload as any, (nextGroupId: number) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.group failed')));
          return;
        }
        const normalized = Number(nextGroupId);
        resolve(Number.isFinite(normalized) ? normalized : null);
      });
    });
  }

  throw webextError('tabs.group unavailable');
}

export async function tabsUngroup(tabIdsInput: number[] | number): Promise<void> {
  const tabIds = normalizeTabIds(tabIdsInput);
  if (!tabIds.length) return;

  const { chrome, browser } = webextApis();

  if (browser?.tabs?.ungroup) {
    await Promise.resolve(browser.tabs.ungroup(tabIds));
    return;
  }

  if (chrome?.tabs?.ungroup) {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.ungroup(tabIds, () => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.ungroup failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  throw webextError('tabs.ungroup unavailable');
}

import { webextApis, webextError, webextLastErrorMessage } from '@platform/webext/base';

type AnyTab = { id?: number; url?: string; title?: string; windowId?: number; active?: boolean };

function shouldLogTabsCreate(url: string): boolean {
  const safeUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(safeUrl)) return false;

  const anyGlobal = globalThis as any;
  if (anyGlobal?.__SYNCNOS_DEBUG_TABS_CREATE__ === true) return true;

  // Keep default noise low: only log NotionAI / Notion site opens unless explicitly enabled.
  return /(^|\/\/)([^/]*\.)?notion\.so(\/|$)/i.test(safeUrl);
}

function debugTabsCreate(createProperties: any) {
  try {
    const url = String(createProperties?.url || '').trim();
    if (!shouldLogTabsCreate(url)) return;
    const stack = new Error('tabs.create stack').stack || '';
    // eslint-disable-next-line no-console
    console.log('[SyncNos][tabs.create]', {
      at: new Date().toISOString(),
      url,
      active: createProperties?.active,
      windowId: createProperties?.windowId,
      stack,
    });
  } catch (_e) {
    // ignore
  }
}

export async function tabsCreate(createProperties: any): Promise<AnyTab | null> {
  debugTabsCreate(createProperties);
  const { chrome, browser } = webextApis();

  if (browser?.tabs?.create) {
    const tab = await Promise.resolve(browser.tabs.create(createProperties));
    return (tab as any) || null;
  }

  if (chrome?.tabs?.create) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab: AnyTab) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.create failed')));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  throw webextError('tabs.create unavailable');
}

export async function tabsQuery(queryInfo: any): Promise<AnyTab[]> {
  const { chrome, browser } = webextApis();

  if (browser?.tabs?.query) {
    const tabs = await Promise.resolve(browser.tabs.query(queryInfo));
    return Array.isArray(tabs) ? tabs : [];
  }

  if (chrome?.tabs?.query) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (tabs: AnyTab[]) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.query failed')));
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  throw webextError('tabs.query unavailable');
}

export async function tabsGet(tabId: number): Promise<AnyTab | null> {
  const { chrome, browser } = webextApis();

  if (browser?.tabs?.get) {
    const tab = await Promise.resolve(browser.tabs.get(tabId));
    return (tab as any) || null;
  }

  if (chrome?.tabs?.get) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab: AnyTab) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.get failed')));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  throw webextError('tabs.get unavailable');
}

export async function tabsUpdate(tabId: number, updateProperties: any): Promise<AnyTab | null> {
  const { chrome, browser } = webextApis();
  const id = Number(tabId);
  if (!Number.isFinite(id) || id < 0) {
    throw webextError('tabs.update unavailable');
  }

  if (browser?.tabs?.update) {
    const tab = await Promise.resolve(browser.tabs.update(id, updateProperties));
    return (tab as any) || null;
  }

  if (chrome?.tabs?.update) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.update(id, updateProperties, (tab: AnyTab) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.update failed')));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  throw webextError('tabs.update unavailable');
}

export async function tabsMove(tabIdsInput: number | number[], moveProperties: any): Promise<AnyTab[]> {
  const { chrome, browser } = webextApis();
  const tabIds = (Array.isArray(tabIdsInput) ? tabIdsInput : [tabIdsInput])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id >= 0);
  if (!tabIds.length) return [];

  const payloadTabIds = tabIds.length === 1 ? tabIds[0] : tabIds;

  if (browser?.tabs?.move) {
    const moved = await Promise.resolve(browser.tabs.move(payloadTabIds as any, moveProperties));
    if (!moved) return [];
    return Array.isArray(moved) ? (moved as AnyTab[]) : [moved as AnyTab];
  }

  if (chrome?.tabs?.move) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.move(payloadTabIds as any, moveProperties, (moved: AnyTab | AnyTab[]) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.move failed')));
          return;
        }
        if (!moved) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(moved) ? moved : [moved]);
      });
    });
  }

  throw webextError('tabs.move unavailable');
}

export async function tabsSendMessage(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  const { chrome, browser } = webextApis();

  if (browser?.tabs?.sendMessage) {
    return await Promise.resolve(browser.tabs.sendMessage(tabId, message));
  }

  if (chrome?.tabs?.sendMessage) {
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (res: any) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.sendMessage failed')));
          return;
        }
        resolve(res ?? null);
      });
    });
  }

  throw webextError('tabs.sendMessage unavailable');
}

export async function tabsRemove(tabId: number): Promise<void> {
  const { chrome, browser } = webextApis();
  const id = Number(tabId);
  if (!Number.isFinite(id) || id < 0) return;

  if (browser?.tabs?.remove) {
    await Promise.resolve(browser.tabs.remove(id));
    return;
  }

  if (chrome?.tabs?.remove) {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.remove(id, () => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('tabs.remove failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  throw webextError('tabs.remove unavailable');
}

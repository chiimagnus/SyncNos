import { webextApis, webextError, webextLastErrorMessage } from '@platform/webext/base';

type AnyTab = { id?: number; url?: string; title?: string; windowId?: number; active?: boolean };

export async function tabsCreate(createProperties: any): Promise<AnyTab | null> {
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

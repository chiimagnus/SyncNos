import { webextApis, webextError, webextLastErrorMessage } from './base';

type AnyTab = { id?: number; url?: string; title?: string };

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


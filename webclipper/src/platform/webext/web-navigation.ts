import { webextApis } from '@platform/webext/base';

export function webNavigationOnCommittedAddListener(listener: (details: any) => void): boolean {
  const { chrome, browser } = webextApis();
  try {
    if (chrome?.webNavigation?.onCommitted?.addListener) {
      chrome.webNavigation.onCommitted.addListener(listener);
      return true;
    }
    if (browser?.webNavigation?.onCommitted?.addListener) {
      browser.webNavigation.onCommitted.addListener(listener);
      return true;
    }
  } catch (_e) {
    // ignore
  }
  return false;
}


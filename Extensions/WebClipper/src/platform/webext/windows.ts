import { webextApis, webextError, webextLastErrorMessage } from './base';

type AnyWindow = { id?: number; focused?: boolean };

export async function windowsUpdate(windowId: number, updateInfo: any): Promise<AnyWindow | null> {
  const { chrome, browser } = webextApis();
  const id = Number(windowId);
  if (!Number.isFinite(id) || id < 0) {
    throw webextError('windows.update unavailable');
  }

  if (browser?.windows?.update) {
    const win = await Promise.resolve(browser.windows.update(id, updateInfo));
    return (win as any) || null;
  }

  if (chrome?.windows?.update) {
    return await new Promise((resolve, reject) => {
      chrome.windows.update(id, updateInfo, (win: AnyWindow) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('windows.update failed')));
          return;
        }
        resolve(win || null);
      });
    });
  }

  throw webextError('windows.update unavailable');
}

import { webextApis, webextError, webextLastErrorMessage } from './base';

export async function scriptingExecuteScript(details: any): Promise<any[]> {
  const { chrome, browser } = webextApis();

  if (browser?.scripting?.executeScript) {
    const results = await Promise.resolve(browser.scripting.executeScript(details));
    return Array.isArray(results) ? results : [];
  }

  if (chrome?.scripting?.executeScript) {
    return await new Promise((resolve, reject) => {
      chrome.scripting.executeScript(details, (results: any[]) => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('executeScript failed')));
          return;
        }
        resolve(Array.isArray(results) ? results : []);
      });
    });
  }

  throw webextError('scripting.executeScript unavailable');
}


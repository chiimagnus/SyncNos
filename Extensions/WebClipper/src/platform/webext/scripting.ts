import { webextApis, webextError, webextLastErrorMessage } from './base';

export function scriptingCanInject(): boolean {
  const { chrome, browser } = webextApis();
  return Boolean(
    (browser?.scripting &&
      typeof browser.scripting.executeScript === 'function' &&
      typeof browser.scripting.insertCSS === 'function') ||
      (chrome?.scripting &&
        typeof chrome.scripting.executeScript === 'function' &&
        typeof chrome.scripting.insertCSS === 'function'),
  );
}

export function scriptingCanDynamicRegister(): boolean {
  const { chrome, browser } = webextApis();
  return Boolean(
    (browser?.scripting &&
      typeof browser.scripting.registerContentScripts === 'function' &&
      typeof browser.scripting.unregisterContentScripts === 'function') ||
      (chrome?.scripting &&
        typeof chrome.scripting.registerContentScripts === 'function' &&
        typeof chrome.scripting.unregisterContentScripts === 'function'),
  );
}

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

export async function scriptingInsertCSS(details: any): Promise<void> {
  const { chrome, browser } = webextApis();

  if (browser?.scripting?.insertCSS) {
    await Promise.resolve(browser.scripting.insertCSS(details));
    return;
  }

  if (chrome?.scripting?.insertCSS) {
    await new Promise<void>((resolve, reject) => {
      chrome.scripting.insertCSS(details, () => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('insertCSS failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  throw webextError('scripting.insertCSS unavailable');
}

export async function scriptingRegisterContentScripts(definitions: any[]): Promise<void> {
  const { chrome, browser } = webextApis();

  if (browser?.scripting?.registerContentScripts) {
    await Promise.resolve(browser.scripting.registerContentScripts(definitions));
    return;
  }

  if (chrome?.scripting?.registerContentScripts) {
    await new Promise<void>((resolve, reject) => {
      chrome.scripting.registerContentScripts(definitions, () => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('registerContentScripts failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  throw webextError('scripting.registerContentScripts unavailable');
}

export async function scriptingUnregisterContentScripts(options: any): Promise<void> {
  const { chrome, browser } = webextApis();

  if (browser?.scripting?.unregisterContentScripts) {
    await Promise.resolve(browser.scripting.unregisterContentScripts(options));
    return;
  }

  if (chrome?.scripting?.unregisterContentScripts) {
    await new Promise<void>((resolve, reject) => {
      chrome.scripting.unregisterContentScripts(options, () => {
        if (chrome?.runtime?.lastError) {
          reject(webextError(webextLastErrorMessage('unregisterContentScripts failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  throw webextError('scripting.unregisterContentScripts unavailable');
}

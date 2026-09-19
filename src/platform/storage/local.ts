function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function getApis() {
  const anyGlobal = globalThis as any;
  return {
    chrome: anyGlobal.chrome,
    browser: anyGlobal.browser,
  };
}

function runtimeLastErrorMessage(fallback: string) {
  const { chrome } = getApis();
  if (chrome?.runtime?.lastError?.message) {
    return String(chrome.runtime.lastError.message || fallback || 'runtime error');
  }
  return String(fallback || 'runtime error');
}

export async function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  const { chrome, browser } = getApis();
  const normalizedKeys = Array.isArray(keys) ? keys : [];

  if (chrome?.storage?.local?.get) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(normalizedKeys, (res: Record<string, unknown>) => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.get failed')));
          return;
        }
        resolve(res ?? {});
      });
    });
  }

  if (browser?.storage?.local?.get) {
    return browser.storage.local.get(normalizedKeys);
  }

  throw toError('storage.local.get unavailable');
}

export async function storageGetAll(): Promise<Record<string, unknown>> {
  const { chrome, browser } = getApis();

  if (chrome?.storage?.local?.get) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null as any, (res: Record<string, unknown>) => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.get failed')));
          return;
        }
        resolve(res ?? {});
      });
    });
  }

  if (browser?.storage?.local?.get) {
    return browser.storage.local.get(null as any);
  }

  throw toError('storage.local.get unavailable');
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  const { chrome, browser } = getApis();
  const payload = (items ?? {}) as Record<string, unknown>;

  if (chrome?.storage?.local?.set) {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.set failed')));
          return;
        }
        resolve();
      });
    });
  }

  if (browser?.storage?.local?.set) {
    return browser.storage.local.set(payload);
  }

  throw toError('storage.local.set unavailable');
}

export async function storageRemove(keys: string[]): Promise<void> {
  const { chrome, browser } = getApis();
  const normalizedKeys = Array.isArray(keys) ? keys : [];

  if (chrome?.storage?.local?.remove) {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.local.remove(normalizedKeys, () => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.remove failed')));
          return;
        }
        resolve();
      });
    });
  }

  if (browser?.storage?.local?.remove) {
    return browser.storage.local.remove(normalizedKeys);
  }

  throw toError('storage.local.remove unavailable');
}

export function storageOnChanged(listener: (changes: any, areaName: string) => void): () => void {
  const anyGlobal = globalThis as any;
  const event = anyGlobal.browser?.storage?.onChanged ?? anyGlobal.chrome?.storage?.onChanged;
  if (!event?.addListener || !event?.removeListener) return () => {};

  try {
    event.addListener(listener);
  } catch (_e) {
    return () => {};
  }

  return () => {
    try {
      event.removeListener(listener);
    } catch (_e) {
      // ignore
    }
  };
}

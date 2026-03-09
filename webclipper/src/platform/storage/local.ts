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
    return await new Promise((resolve, reject) => {
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
    return (await browser.storage.local.get(normalizedKeys)) as Record<string, unknown>;
  }

  throw toError('storage.local.get unavailable');
}

export async function storageGetAll(): Promise<Record<string, unknown>> {
  const { chrome, browser } = getApis();

  if (chrome?.storage?.local?.get) {
    return await new Promise((resolve, reject) => {
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
    return (await browser.storage.local.get(null as any)) as Record<string, unknown>;
  }

  throw toError('storage.local.get unavailable');
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  const { chrome, browser } = getApis();
  const payload = (items ?? {}) as Record<string, unknown>;

  if (chrome?.storage?.local?.set) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.set failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  if (browser?.storage?.local?.set) {
    await browser.storage.local.set(payload);
    return;
  }

  throw toError('storage.local.set unavailable');
}

export async function storageRemove(keys: string[]): Promise<void> {
  const { chrome, browser } = getApis();
  const normalizedKeys = Array.isArray(keys) ? keys : [];

  if (chrome?.storage?.local?.remove) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.remove(normalizedKeys, () => {
        if (chrome?.runtime?.lastError) {
          reject(toError(runtimeLastErrorMessage('storage.remove failed')));
          return;
        }
        resolve();
      });
    });
    return;
  }

  if (browser?.storage?.local?.remove) {
    await browser.storage.local.remove(normalizedKeys);
    return;
  }

  throw toError('storage.local.remove unavailable');
}

export function storageOnChanged(listener: (changes: any, areaName: string) => void): () => void {
  if (typeof listener !== 'function') return () => {};

  const anyGlobal = globalThis as any;
  const event = anyGlobal.browser?.storage?.onChanged ?? anyGlobal.chrome?.storage?.onChanged;
  if (!event?.addListener) return () => {};

  try {
    event.addListener(listener);
  } catch (_e) {
    return () => {};
  }

  return () => {
    try {
      event.removeListener?.(listener);
    } catch (_e) {
      // ignore
    }
  };
}

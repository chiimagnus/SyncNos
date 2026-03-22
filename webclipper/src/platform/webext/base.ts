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

export function webextApis() {
  return getApis();
}

export function webextLastErrorMessage(fallback: string) {
  return runtimeLastErrorMessage(fallback);
}

export function webextError(message: unknown) {
  return toError(message);
}

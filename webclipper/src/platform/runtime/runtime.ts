const INVALIDATED_MESSAGE = 'Extension context invalidated';
const INVALIDATED_RE = /Extension context invalidated/i;

function toError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof Error) return err;
  return new Error(String(err ?? fallbackMessage));
}

export function isInvalidContextError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err ?? '');
  return INVALIDATED_RE.test(message);
}

export async function sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
  const anyGlobal = globalThis as any;

  // Prefer promise-based `browser.*` when available (WXT/dev polyfill).
  try {
    const maybeBrowser = anyGlobal.browser;
    if (maybeBrowser?.runtime?.sendMessage) {
      const out = maybeBrowser.runtime.sendMessage(message as any);
      if (out && typeof out.then === 'function') {
        return (await out) as TResponse;
      }
    }
  } catch (err) {
    throw toError(err, 'runtime.sendMessage failed');
  }

  // Fallback: callback-based `chrome.*` (Chrome stable API surface).
  const maybeChrome = anyGlobal.chrome;
  if (maybeChrome?.runtime?.sendMessage) {
    return (await new Promise((resolve, reject) => {
      try {
        maybeChrome.runtime.sendMessage(message as any, (response: any) => {
          const runtimeError = maybeChrome.runtime?.lastError;
          if (runtimeError) return reject(new Error(String(runtimeError.message || runtimeError)));
          resolve(response);
        });
      } catch (e) {
        reject(e);
      }
    })) as TResponse;
  }

  throw new Error(INVALIDATED_MESSAGE);
}

export async function send<TResponse = unknown>(
  type: string,
  payload?: Record<string, unknown>,
): Promise<TResponse> {
  if (!type) throw new Error('Message type is required');
  return sendMessage<TResponse>({ type, ...(payload ?? {}) });
}

export function getURL(path: string): string {
  const anyGlobal = globalThis as any;
  const rt = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
  if (!rt?.getURL) return '';

  try {
    return rt.getURL(path);
  } catch (err) {
    const normalized = toError(err, 'runtime.getURL failed');
    if (isInvalidContextError(normalized)) return '';
    throw normalized;
  }
}

export function getManifest(): any | null {
  const anyGlobal = globalThis as any;
  const rt = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
  if (!rt?.getManifest) return null;

  try {
    return rt.getManifest() as any;
  } catch (err) {
    const normalized = toError(err, 'runtime.getManifest failed');
    if (isInvalidContextError(normalized)) return null;
    throw normalized;
  }
}

export type RuntimeInstalledDetails = {
  reason?: string;
  previousVersion?: string;
  temporary?: boolean;
  id?: string;
};

export function onInstalled(listener: (details?: RuntimeInstalledDetails) => void): void {
  if (typeof listener !== 'function') return;
  const anyGlobal = globalThis as any;
  const browserRuntime = anyGlobal.browser?.runtime;
  if (browserRuntime?.onInstalled?.addListener) {
    browserRuntime.onInstalled.addListener(listener);
    return;
  }
  const chromeRuntime = anyGlobal.chrome?.runtime;
  if (chromeRuntime?.onInstalled?.addListener) {
    chromeRuntime.onInstalled.addListener(listener);
  }
}

export function onStartup(listener: () => void): void {
  if (typeof listener !== 'function') return;
  const anyGlobal = globalThis as any;
  const browserRuntime = anyGlobal.browser?.runtime;
  if (browserRuntime?.onStartup?.addListener) {
    browserRuntime.onStartup.addListener(listener);
    return;
  }
  const chromeRuntime = anyGlobal.chrome?.runtime;
  if (chromeRuntime?.onStartup?.addListener) {
    chromeRuntime.onStartup.addListener(listener);
  }
}

export { INVALIDATED_MESSAGE };

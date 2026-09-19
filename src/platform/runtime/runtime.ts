const INVALIDATED_MESSAGE = 'Extension context invalidated';
const INVALIDATED_RE = /Extension context invalidated/i;
const DEFAULT_SEND_MESSAGE_TIMEOUT_MS = 60_000;

function toError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof Error) return err;
  return new Error(String(err ?? fallbackMessage));
}

export function isInvalidContextError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err ?? '');
  return INVALIDATED_RE.test(message);
}

type SendMessageOptions = {
  timeoutMs?: number;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function sendMessage<TResponse = unknown>(
  message: unknown,
  options: SendMessageOptions = {},
): Promise<TResponse> {
  const timeoutMs =
    options.timeoutMs == null ? DEFAULT_SEND_MESSAGE_TIMEOUT_MS : Math.max(0, Number(options.timeoutMs) || 0);
  const anyGlobal = globalThis as any;

  // Prefer promise-based `browser.*` when available (WXT/dev polyfill).
  try {
    const maybeBrowser = anyGlobal.browser;
    if (maybeBrowser?.runtime?.sendMessage) {
      const out = maybeBrowser.runtime.sendMessage(message as any);
      if (out && typeof out.then === 'function') {
        return (await withTimeout(out as Promise<TResponse>, timeoutMs, 'runtime.sendMessage')) as TResponse;
      }
    }
  } catch (err) {
    throw toError(err, 'runtime.sendMessage failed');
  }

  // Fallback: callback-based `chrome.*` (Chrome stable API surface).
  const maybeChrome = anyGlobal.chrome;
  if (maybeChrome?.runtime?.sendMessage) {
    const p = new Promise<TResponse>((resolve, reject) => {
      try {
        maybeChrome.runtime.sendMessage(message as any, (response: any) => {
          const runtimeError = maybeChrome.runtime?.lastError;
          if (runtimeError) return reject(new Error(String(runtimeError.message || runtimeError)));
          resolve(response as TResponse);
        });
      } catch (e) {
        reject(e);
      }
    });
    return await withTimeout(p, timeoutMs, 'runtime.sendMessage');
  }

  throw new Error(INVALIDATED_MESSAGE);
}

export async function send<TResponse = unknown>(type: string, payload?: Record<string, unknown>): Promise<TResponse> {
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

type RuntimeInstalledDetails = {
  reason?: string;
  previousVersion?: string;
  temporary?: boolean;
  id?: string;
};

export function onInstalled(listener: (details?: RuntimeInstalledDetails) => void): void {
  const anyGlobal = globalThis as any;
  const event = anyGlobal.browser?.runtime?.onInstalled ?? anyGlobal.chrome?.runtime?.onInstalled;
  if (!event?.addListener) return;
  try {
    event.addListener(listener);
  } catch (_error) {
    // Runtime listener registration is optional when the extension context is unavailable.
  }
}

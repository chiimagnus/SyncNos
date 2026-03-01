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
  try {
    return (await browser.runtime.sendMessage(message as any)) as TResponse;
  } catch (err) {
    throw toError(err, 'runtime.sendMessage failed');
  }
}

export async function send<TResponse = unknown>(
  type: string,
  payload?: Record<string, unknown>,
): Promise<TResponse> {
  if (!type) throw new Error('Message type is required');
  return sendMessage<TResponse>({ type, ...(payload ?? {}) });
}

export function getURL(path: string): string {
  try {
    return browser.runtime.getURL(path);
  } catch (err) {
    const normalized = toError(err, 'runtime.getURL failed');
    if (isInvalidContextError(normalized)) return '';
    throw normalized;
  }
}

export { INVALIDATED_MESSAGE };


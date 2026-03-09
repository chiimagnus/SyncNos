import { getURL, isInvalidContextError, send, sendMessage } from './runtime';

const INVALIDATED_MESSAGE = 'Extension context invalidated';

function toError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof Error) return err;
  return new Error(String(err ?? fallbackMessage));
}

function hasRuntime(): boolean {
  const anyGlobal = globalThis as any;
  const runtime = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
  return Boolean(runtime && runtime.id);
}

export function createRuntimeClient() {
  let invalidated = false;
  const listeners = new Set<(error: Error) => void>();

  function notifyInvalidated(reason: unknown) {
    if (invalidated) return;
    invalidated = true;
    const error = toError(reason, INVALIDATED_MESSAGE);
    for (const listener of Array.from(listeners)) {
      try {
        listener(error);
      } catch (_e) {
        // ignore listener failures
      }
    }
  }

  function ensureAvailable() {
    if (!hasRuntime() || invalidated) throw new Error(INVALIDATED_MESSAGE);
  }

  async function wrappedSendMessage(message: unknown) {
    try {
      ensureAvailable();
      return await sendMessage(message);
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated(error);
      throw error;
    }
  }

  async function wrappedSend(type: string, payload?: Record<string, unknown>) {
    try {
      ensureAvailable();
      return await send(type, payload);
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated(error);
      throw error;
    }
  }

  function wrappedGetURL(path: string): string {
    try {
      ensureAvailable();
      return getURL(path);
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated(error);
      return '';
    }
  }

  function onInvalidated(listener: (error: Error) => void) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getURL: wrappedGetURL,
    isInvalidContextError,
    onInvalidated,
    send: wrappedSend,
    sendMessage: wrappedSendMessage,
  };
}

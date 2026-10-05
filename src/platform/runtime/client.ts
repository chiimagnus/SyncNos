import { getURL, isInvalidContextError, send, sendMessage } from '@platform/runtime/runtime';

const INVALIDATED_MESSAGE = 'Extension context invalidated';

function hasRuntime(): boolean {
  const anyGlobal = globalThis as any;
  const runtime = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
  return Boolean(runtime && runtime.id);
}

export function createRuntimeClient() {
  let invalidated = false;
  let invalidationListener: (() => void) | null = null;

  function notifyInvalidated() {
    if (invalidated) return;
    invalidated = true;
    const listener = invalidationListener;
    invalidationListener = null;
    listener?.();
  }

  function ensureAvailable() {
    if (!hasRuntime() || invalidated) throw new Error(INVALIDATED_MESSAGE);
  }

  async function wrappedSendMessage(message: unknown) {
    try {
      ensureAvailable();
      return await sendMessage(message);
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated();
      throw error;
    }
  }

  async function wrappedSend(type: string, payload?: Record<string, unknown>) {
    try {
      ensureAvailable();
      return await send(type, payload);
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated();
      throw error;
    }
  }

  function wrappedGetURL(path: string): string {
    try {
      ensureAvailable();
      const anyGlobal = globalThis as any;
      const runtime = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
      const hasGetUrlCapability = typeof runtime?.getURL === 'function';
      const url = getURL(path);
      if (hasGetUrlCapability && !url) notifyInvalidated();
      return url;
    } catch (error) {
      if (isInvalidContextError(error)) notifyInvalidated();
      return '';
    }
  }

  function onInvalidated(listener: () => void) {
    if (invalidated) return () => {};
    invalidationListener = listener;
    return () => {
      if (invalidationListener === listener) invalidationListener = null;
    };
  }

  return {
    getURL: wrappedGetURL,
    onInvalidated,
    send: wrappedSend,
    sendMessage: wrappedSendMessage,
  };
}

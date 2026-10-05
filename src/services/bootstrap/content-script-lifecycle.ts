import { storageGet, storageSet } from '@platform/storage/local';

const CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY = 'inpage_content_script_lifecycle_token_v1';
const CONTENT_SCRIPT_DISPOSE_EVENT_PREFIX = '__syncnos_content_script_dispose__';
const CONTENT_SCRIPT_LIFECYCLE_TOKEN_RE = /^[a-f0-9]{32}$/;

type Cleanup = () => void;

function normalizeLifecycleToken(value: unknown): string {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  return CONTENT_SCRIPT_LIFECYCLE_TOKEN_RE.test(token) ? token : '';
}

function createLifecycleToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function ensureContentScriptLifecycleToken(): Promise<string> {
  const current = normalizeLifecycleToken(
    (await storageGet([CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY]))[CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY],
  );
  if (current) return current;

  const created = createLifecycleToken();
  await storageSet({ [CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY]: created });
  const confirmed = normalizeLifecycleToken(
    (await storageGet([CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY]))[CONTENT_SCRIPT_LIFECYCLE_TOKEN_STORAGE_KEY],
  );
  return confirmed || created;
}

function safeCleanup(cleanup: Cleanup): void {
  try {
    cleanup();
  } catch (_error) {
    // One teardown failure must not leave the rest of the content-script generation alive.
  }
}

export function startContentScriptLifecycle(document: Document, lifecycleToken: string) {
  const disposeEvent = `${CONTENT_SCRIPT_DISPOSE_EVENT_PREFIX}${lifecycleToken}`;
  const EventCtor = document.defaultView?.Event;
  if (EventCtor) document.dispatchEvent(new EventCtor(disposeEvent));

  let disposed = false;
  const cleanups: Cleanup[] = [];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener(disposeEvent, dispose);
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      safeCleanup(cleanups[index]!);
    }
    cleanups.length = 0;
  };

  document.addEventListener(disposeEvent, dispose);

  const addCleanup = (cleanup: Cleanup) => {
    if (disposed) {
      safeCleanup(cleanup);
      return;
    }
    cleanups.push(cleanup);
  };

  return {
    addCleanup,
    dispose,
    isDisposed: () => disposed,
  };
}

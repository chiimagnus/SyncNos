type StoreResponse = {
  url: string;
  contentType?: string;
  bodyText: string;
  at: number;
};

type VideoTranscriptBridgeStore = {
  responses: StoreResponse[];
  metaByRequestId: Record<string, any>;
};

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';

function getStore(): VideoTranscriptBridgeStore | null {
  const anyGlobal = globalThis as any;
  const store = anyGlobal?.[STORE_KEY] as VideoTranscriptBridgeStore | undefined;
  if (!store) return null;
  if (!Array.isArray(store.responses)) return null;
  if (!store.metaByRequestId || typeof store.metaByRequestId !== 'object') return null;
  return store;
}

export function listVideoInterceptedResponses(): StoreResponse[] {
  const store = getStore();
  const list = store?.responses;
  if (!Array.isArray(list) || !list.length) return [];
  return list.slice();
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch (_e) {
    // ignore
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}

export async function requestVideoPageMeta(options?: { timeoutMs?: number }): Promise<any | null> {
  const requestId = randomId();
  try {
    window.postMessage({ __syncnos: true, type: 'SYNCNOS_VIDEO_META_REQUEST', requestId }, '*');
  } catch (_e) {
    return null;
  }

  const timeoutMs = Math.max(120, Number(options?.timeoutMs) || 1200);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const store = getStore();
    const meta = store?.metaByRequestId?.[requestId];
    if (meta !== undefined) return meta ?? null;
    await sleep(50);
  }
  return null;
}


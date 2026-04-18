type StoreResponse = {
  url: string;
  contentType?: string;
  bodyText: string;
  at: number;
};

type StoreMetaByRequestId = Record<string, any>;

type VideoTranscriptBridgeStore = {
  responses: StoreResponse[];
  metaByRequestId: StoreMetaByRequestId;
};

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';
const MAX_RESPONSES = 30;
const MAX_BODY_CHARS = 2_000_000;

function getStore(): VideoTranscriptBridgeStore {
  const anyGlobal = globalThis as any;
  const existing = anyGlobal[STORE_KEY] as VideoTranscriptBridgeStore | undefined;
  if (
    existing &&
    Array.isArray(existing.responses) &&
    existing.metaByRequestId &&
    typeof existing.metaByRequestId === 'object'
  ) {
    return existing;
  }
  const created: VideoTranscriptBridgeStore = { responses: [], metaByRequestId: {} };
  anyGlobal[STORE_KEY] = created;
  return created;
}

function safeSliceBody(text: string): string {
  const value = String(text || '');
  if (value.length <= MAX_BODY_CHARS) return value;
  return value.slice(0, MAX_BODY_CHARS);
}

function pushResponse(store: VideoTranscriptBridgeStore, next: StoreResponse) {
  const url = String(next?.url || '').trim();
  const bodyText = String(next?.bodyText || '');
  if (!url || !bodyText) return;
  const item: StoreResponse = {
    url,
    contentType: next?.contentType ? String(next.contentType) : undefined,
    bodyText: safeSliceBody(bodyText),
    at: Number(next?.at) || Date.now(),
  };
  store.responses.push(item);
  if (store.responses.length > MAX_RESPONSES) {
    store.responses.splice(0, store.responses.length - MAX_RESPONSES);
  }
}

export default defineContentScript({
  matches: [
    'https://www.youtube.com/watch*',
    'https://youtu.be/*',
    'https://www.bilibili.com/video/*',
    'https://bilibili.com/video/*',
  ],
  runAt: 'document_start',
  main() {
    const store = getStore();

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = (event as any)?.data;
      if (!data || data.__syncnos !== true) return;

      if (data.type === 'SYNCNOS_VIDEO_INTERCEPTED') {
        pushResponse(store, {
          url: String(data.url || ''),
          contentType: data.contentType ? String(data.contentType) : undefined,
          bodyText: String(data.bodyText || ''),
          at: Number(data.at) || Date.now(),
        });
        return;
      }

      if (data.type === 'SYNCNOS_VIDEO_META_RESPONSE') {
        const requestId = String(data.requestId || '').trim();
        if (!requestId) return;
        store.metaByRequestId[requestId] = data.meta ?? null;
      }
    });
  },
});

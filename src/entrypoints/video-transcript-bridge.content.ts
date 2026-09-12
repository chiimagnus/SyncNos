import { classifyVideoResponseUrl } from '@services/shared/video-capture';

type StoreResponse = {
  url: string;
  pageUrl: string;
  contentType?: string;
  bodyText: string;
  at: number;
};

type VideoTranscriptBridgeStore = {
  responses: StoreResponse[];
};

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';
const MAX_RESPONSES = 30;
const MAX_BODY_CHARS = 2_000_000;

function getStore(): VideoTranscriptBridgeStore {
  const anyGlobal = globalThis as any;
  const existing = anyGlobal[STORE_KEY] as VideoTranscriptBridgeStore | undefined;
  if (existing && Array.isArray(existing.responses)) return existing;
  const created: VideoTranscriptBridgeStore = { responses: [] };
  anyGlobal[STORE_KEY] = created;
  return created;
}

function pushResponse(store: VideoTranscriptBridgeStore, next: StoreResponse) {
  const url = String(next?.url || '').trim();
  const pageUrl = String(next?.pageUrl || '').trim();
  const bodyText = String(next?.bodyText || '');
  if (!classifyVideoResponseUrl(url) || !pageUrl || !bodyText || bodyText.length > MAX_BODY_CHARS) return;

  store.responses.push({
    url,
    pageUrl,
    contentType: next?.contentType ? String(next.contentType) : undefined,
    bodyText,
    at: Number(next?.at) || Date.now(),
  });
  if (store.responses.length > MAX_RESPONSES) {
    store.responses.splice(0, store.responses.length - MAX_RESPONSES);
  }
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://youtu.be/*', 'https://www.bilibili.com/*', 'https://bilibili.com/*'],
  runAt: 'document_start',
  main() {
    const store = getStore();

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || data.__syncnos !== true || data.type !== 'SYNCNOS_VIDEO_INTERCEPTED') return;
      pushResponse(store, {
        url: String(data.url || ''),
        pageUrl: String(data.pageUrl || ''),
        contentType: data.contentType ? String(data.contentType) : undefined,
        bodyText: String(data.bodyText || ''),
        at: Number(data.at) || Date.now(),
      });
    });
  },
});

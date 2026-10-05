import { classifyVideoResponseUrl } from '@services/shared/video-capture';

type StoreResponse = {
  url: string;
  pageUrl: string;
  bodyText: string;
};

type VideoTranscriptBridgeStore = {
  responses: StoreResponse[];
};

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';

function getStore(): VideoTranscriptBridgeStore {
  const anyGlobal = globalThis as any;
  const existing = anyGlobal[STORE_KEY] as VideoTranscriptBridgeStore | undefined;
  if (existing && Array.isArray(existing.responses)) return existing;
  const created: VideoTranscriptBridgeStore = { responses: [] };
  anyGlobal[STORE_KEY] = created;
  return created;
}

function pushResponse(store: VideoTranscriptBridgeStore, next: unknown) {
  const input = next && typeof next === 'object' ? (next as Record<string, unknown>) : {};
  const url = String(input.url || '').trim();
  const pageUrl = String(input.pageUrl || '').trim();
  const bodyText = String(input.bodyText || '');
  const kind = classifyVideoResponseUrl(url);
  if (!kind || !pageUrl || !bodyText) return;

  const response = { url, pageUrl, bodyText };
  const index = store.responses.findIndex((item) => classifyVideoResponseUrl(item.url) === kind);
  if (index >= 0) store.responses[index] = response;
  else store.responses.push(response);
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
      pushResponse(store, data);
    });
  },
});

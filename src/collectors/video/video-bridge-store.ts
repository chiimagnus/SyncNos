import type { VideoPageMetaCandidates } from '@services/shared/video-capture';

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
const DEFAULT_META_TIMEOUT_MS = 1200;

function getStore(): VideoTranscriptBridgeStore | null {
  const anyGlobal = globalThis as any;
  const store = anyGlobal?.[STORE_KEY] as VideoTranscriptBridgeStore | undefined;
  if (!store || !Array.isArray(store.responses)) return null;
  return store;
}

export function listVideoInterceptedResponses(): StoreResponse[] {
  const list = getStore()?.responses;
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

export function requestVideoPageMeta(options?: { timeoutMs?: number }): Promise<VideoPageMetaCandidates | null> {
  const requestedTimeout = Number(options?.timeoutMs);
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout >= 0 ? Math.floor(requestedTimeout) : DEFAULT_META_TIMEOUT_MS;
  const requestId = randomId();

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: VideoPageMetaCandidates | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (timer != null) clearTimeout(timer);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || data.__syncnos !== true || data.type !== 'SYNCNOS_VIDEO_META_RESPONSE') return;
      if (String(data.requestId || '') !== requestId) return;
      const meta = data.meta;
      if (!meta || typeof meta !== 'object') {
        finish(null);
        return;
      }
      finish({
        state: meta.state && typeof meta.state === 'object' ? meta.state : null,
        dom: meta.dom && typeof meta.dom === 'object' ? meta.dom : null,
      });
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish(null), timeoutMs);

    try {
      window.postMessage({ __syncnos: true, type: 'SYNCNOS_VIDEO_META_REQUEST', requestId }, '*');
    } catch (_error) {
      finish(null);
    }
  });
}

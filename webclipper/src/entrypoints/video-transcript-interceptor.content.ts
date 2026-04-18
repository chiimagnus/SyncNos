type InterceptedResponsePayload = {
  __syncnos: true;
  type: 'SYNCNOS_VIDEO_INTERCEPTED';
  url: string;
  contentType?: string;
  bodyText: string;
  at: number;
};

type MetaRequestPayload = {
  __syncnos: true;
  type: 'SYNCNOS_VIDEO_META_REQUEST';
  requestId: string;
};

type MetaResponsePayload = {
  __syncnos: true;
  type: 'SYNCNOS_VIDEO_META_RESPONSE';
  requestId: string;
  meta: any;
};

const MAX_BODY_CHARS = 2_000_000;

function normalizeUrl(raw: unknown): string {
  return String(raw || '').trim();
}

function isYoutubeHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'www.youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be';
}

function isBilibiliHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'www.bilibili.com' || h.endsWith('.bilibili.com') || h === 'bilibili.com';
}

function shouldInterceptUrl(raw: string): boolean {
  const url = normalizeUrl(raw);
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com/api/timedtext')) return true;
  if (lower.includes('/bfs/ai_subtitle/')) return true;
  if (lower.includes('hdslb.com/bfs/subtitle/') && lower.includes('.json')) return true;
  if (lower.includes('api.bilibili.com/x/player/wbi/v2')) return true;
  return false;
}

function safeSliceBody(text: string): string {
  const value = String(text || '');
  if (value.length <= MAX_BODY_CHARS) return value;
  return value.slice(0, MAX_BODY_CHARS);
}

function postIntercept(payload: Omit<InterceptedResponsePayload, '__syncnos' | 'type'>) {
  try {
    window.postMessage(
      {
        __syncnos: true,
        type: 'SYNCNOS_VIDEO_INTERCEPTED',
        ...payload,
      } satisfies InterceptedResponsePayload,
      '*',
    );
  } catch (_e) {
    // ignore
  }
}

function parseContentType(value: unknown): string {
  return String(value || '').trim();
}

function collectYoutubeMeta() {
  try {
    const pr: any = (window as any).ytInitialPlayerResponse;
    const details = pr?.videoDetails || null;
    const title = String(details?.title || '').trim();
    const author = String(details?.author || '').trim();
    const lengthSeconds = Number(details?.lengthSeconds);
    const durationSeconds = Number.isFinite(lengthSeconds) ? Math.max(0, Math.floor(lengthSeconds)) : null;

    const thumbs = Array.isArray(details?.thumbnail?.thumbnails) ? details.thumbnail.thumbnails : [];
    const bestThumb = thumbs.length ? thumbs[thumbs.length - 1] : null;
    const thumbnailUrl = bestThumb?.url ? String(bestThumb.url) : '';

    return {
      platform: 'youtube',
      title,
      author,
      durationSeconds,
      thumbnailUrl,
    };
  } catch (_e) {
    return null;
  }
}

function collectBilibiliMeta() {
  try {
    const state: any = (window as any).__INITIAL_STATE__;
    const videoData = state?.videoData || null;
    const title = String(videoData?.title || '').trim();
    const author = String(videoData?.owner?.name || '').trim();
    const durationSeconds = Number.isFinite(Number(videoData?.duration))
      ? Math.max(0, Math.floor(Number(videoData.duration)))
      : null;
    const thumbnailUrl = String(videoData?.pic || '').trim();

    return {
      platform: 'bilibili',
      title,
      author,
      durationSeconds,
      thumbnailUrl,
    };
  } catch (_e) {
    return null;
  }
}

function collectMetaForPage() {
  const host = String(location.hostname || '').toLowerCase();
  if (isYoutubeHost(host)) return collectYoutubeMeta();
  if (isBilibiliHost(host)) return collectBilibiliMeta();
  return null;
}

function wrapFetch() {
  const original = (globalThis as any).fetch;
  if (typeof original !== 'function') return;

  (globalThis as any).fetch = async function (...args: any[]) {
    const res = await original.apply(this, args);
    try {
      const url = normalizeUrl(res?.url || args?.[0]);
      if (!shouldInterceptUrl(url)) return res;

      const cloned = res?.clone?.();
      if (!cloned || typeof cloned.text !== 'function') return res;
      const contentType = parseContentType(cloned?.headers?.get?.('content-type') || '');
      const bodyText = safeSliceBody(await cloned.text());
      postIntercept({ url, contentType, bodyText, at: Date.now() });
    } catch (_e) {
      // ignore
    }
    return res;
  };
}

function wrapXhr() {
  const Xhr = (globalThis as any).XMLHttpRequest;
  if (!Xhr || !Xhr.prototype) return;

  const originalOpen = Xhr.prototype.open;
  const originalSend = Xhr.prototype.send;
  if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') return;

  Xhr.prototype.open = function (...args: any[]) {
    try {
      (this as any).__syncnos_url = String(args?.[1] || '');
    } catch (_e) {
      // ignore
    }
    return originalOpen.apply(this, args);
  };

  Xhr.prototype.send = function (...args: any[]) {
    try {
      const url = normalizeUrl((this as any).__syncnos_url || '');
      if (shouldInterceptUrl(url)) {
        this.addEventListener(
          'load',
          () => {
            try {
              const contentType = parseContentType((this as any).getResponseHeader?.('content-type') || '');
              let bodyText = safeSliceBody(String((this as any).responseText || ''));
              if (!bodyText) {
                const responseType = String((this as any).responseType || '');
                const response = (this as any).response;
                if (responseType === 'json' && response != null) {
                  try {
                    bodyText = safeSliceBody(JSON.stringify(response));
                  } catch (_e) {
                    // ignore
                  }
                } else if (responseType === 'arraybuffer' && response && typeof response.byteLength === 'number') {
                  try {
                    if (typeof TextDecoder === 'function') {
                      bodyText = safeSliceBody(new TextDecoder('utf-8').decode(response));
                    }
                  } catch (_e) {
                    // ignore
                  }
                }
              }
              if (!bodyText) return;
              postIntercept({ url, contentType, bodyText, at: Date.now() });
            } catch (_e) {
              // ignore
            }
          },
          { once: true } as any,
        );
      }
    } catch (_e) {
      // ignore
    }
    return originalSend.apply(this, args);
  };
}

export default defineContentScript({
  matches: [
    'https://www.youtube.com/watch*',
    'https://youtu.be/*',
    'https://www.bilibili.com/video/*',
    'https://bilibili.com/video/*',
  ],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    wrapFetch();
    wrapXhr();

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = (event as any)?.data;
      if (!data || data.__syncnos !== true) return;
      if (data.type !== 'SYNCNOS_VIDEO_META_REQUEST') return;
      const requestId = String((data as MetaRequestPayload).requestId || '').trim();
      if (!requestId) return;

      try {
        const meta = collectMetaForPage();
        window.postMessage(
          {
            __syncnos: true,
            type: 'SYNCNOS_VIDEO_META_RESPONSE',
            requestId,
            meta: meta || null,
          } satisfies MetaResponsePayload,
          '*',
        );
      } catch (_e) {
        // ignore
      }
    });
  },
});

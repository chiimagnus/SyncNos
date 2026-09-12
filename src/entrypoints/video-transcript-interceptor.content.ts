import { canonicalizeVideoUrl } from '@services/url-cleaning/video-url';
import {
  classifyVideoResponseUrl,
  type VideoPageMetaCandidate,
  type VideoPageMetaCandidates,
} from '@services/shared/video-capture';

type InterceptedResponsePayload = {
  __syncnos: true;
  type: 'SYNCNOS_VIDEO_INTERCEPTED';
  url: string;
  pageUrl: string;
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
  meta: VideoPageMetaCandidates;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function normalizeDuration(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function resolveAbsoluteUrl(raw: unknown): string {
  const source = typeof raw === 'object' && raw && 'url' in raw ? (raw as { url?: unknown }).url : raw;
  const text = String(source ?? '').trim();
  if (!text) return '';
  try {
    return new URL(text, document.baseURI || location.href).toString();
  } catch (_error) {
    return '';
  }
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

function collectYoutubeStateCandidate(): VideoPageMetaCandidate | null {
  try {
    const details: any = (window as any).ytInitialPlayerResponse?.videoDetails || null;
    const videoId = normalizeText(details?.videoId);
    if (!videoId) return null;
    const identityUrl = canonicalizeVideoUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
    if (!identityUrl) return null;

    const thumbs = Array.isArray(details?.thumbnail?.thumbnails) ? details.thumbnail.thumbnails : [];
    const bestThumb = thumbs.length ? thumbs[thumbs.length - 1] : null;
    return {
      platform: 'youtube',
      identityUrl,
      title: normalizeText(details?.title),
      author: normalizeText(details?.author),
      description: normalizeText(details?.shortDescription),
      durationSeconds: normalizeDuration(details?.lengthSeconds),
      thumbnailUrl: normalizeText(bestThumb?.url),
    };
  } catch (_error) {
    return null;
  }
}

function bilibiliIdentityFromState(bvid: string): string {
  try {
    const candidate = new URL(`https://www.bilibili.com/video/${bvid}/`);
    const current = new URL(location.href);
    const p = String(current.searchParams.get('p') || '').trim();
    if (p) candidate.searchParams.set('p', p);
    return canonicalizeVideoUrl(candidate.toString());
  } catch (_error) {
    return '';
  }
}

function collectBilibiliStateCandidate(): VideoPageMetaCandidate | null {
  try {
    const videoData: any = (window as any).__INITIAL_STATE__?.videoData || null;
    const bvid = normalizeText(videoData?.bvid);
    if (!bvid) return null;
    const identityUrl = bilibiliIdentityFromState(bvid);
    if (!identityUrl) return null;

    const desc = normalizeText(videoData?.desc);
    const descV2 = Array.isArray(videoData?.desc_v2)
      ? videoData.desc_v2
          .map((item: any) => normalizeText(item?.raw_text))
          .filter(Boolean)
          .join('\n')
      : '';

    return {
      platform: 'bilibili',
      identityUrl,
      title: normalizeText(videoData?.title),
      author: normalizeText(videoData?.owner?.name),
      description: desc || descV2,
      durationSeconds: normalizeDuration(videoData?.duration),
      thumbnailUrl: normalizeText(videoData?.pic),
    };
  } catch (_error) {
    return null;
  }
}

function collectBilibiliDomCandidate(): VideoPageMetaCandidate | null {
  try {
    const identityUrl = canonicalizeVideoUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href'));
    if (!identityUrl) return null;
    return {
      platform: 'bilibili',
      identityUrl,
      title: normalizeText((document.querySelector('h1.video-title') as HTMLElement | null)?.innerText),
      author: normalizeText((document.querySelector('a.up-name') as HTMLElement | null)?.innerText),
      description: normalizeText((document.querySelector('.desc-info-text') as HTMLElement | null)?.innerText),
    };
  } catch (_error) {
    return null;
  }
}

function collectMetaForPage(): VideoPageMetaCandidates {
  const host = String(location.hostname || '').toLowerCase();
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'youtu.be') {
    return { state: collectYoutubeStateCandidate(), dom: null };
  }
  if (host === 'www.bilibili.com' || host === 'bilibili.com') {
    return { state: collectBilibiliStateCandidate(), dom: collectBilibiliDomCandidate() };
  }
  return { state: null, dom: null };
}

function wrapFetch() {
  const original = (globalThis as any).fetch;
  if (typeof original !== 'function') return;

  (globalThis as any).fetch = async function (...args: any[]) {
    const pageUrl = String(location.href || '');
    const response = await original.apply(this, args);
    try {
      const url = resolveAbsoluteUrl(response?.url || args?.[0]);
      if (!classifyVideoResponseUrl(url)) return response;
      const cloned = response?.clone?.();
      if (!cloned || typeof cloned.text !== 'function') return response;
      const bodyText = String(await cloned.text());
      if (!bodyText) return response;
      postIntercept({
        url,
        pageUrl,
        bodyText,
        at: Date.now(),
      });
    } catch (_error) {
      // ignore
    }
    return response;
  };
}

function readXhrBody(xhr: any): string {
  const responseType = String(xhr?.responseType || '');
  if (!responseType || responseType === 'text') return String(xhr?.responseText || '');
  if (responseType === 'json') {
    if (xhr?.response == null) return '';
    try {
      return JSON.stringify(xhr.response);
    } catch (_error) {
      return '';
    }
  }
  if (responseType === 'arraybuffer' && xhr?.response && typeof xhr.response.byteLength === 'number') {
    try {
      return typeof TextDecoder === 'function' ? new TextDecoder('utf-8').decode(xhr.response) : '';
    } catch (_error) {
      return '';
    }
  }
  return '';
}

function wrapXhr() {
  const Xhr = (globalThis as any).XMLHttpRequest;
  if (!Xhr?.prototype) return;

  const originalOpen = Xhr.prototype.open;
  const originalSend = Xhr.prototype.send;
  if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') return;

  Xhr.prototype.open = function (...args: any[]) {
    try {
      (this as any).__syncnos_url = resolveAbsoluteUrl(args?.[1]);
    } catch (_error) {
      // ignore
    }
    return originalOpen.apply(this, args);
  };

  Xhr.prototype.send = function (...args: any[]) {
    try {
      const url = String((this as any).__syncnos_url || '');
      if (classifyVideoResponseUrl(url)) {
        const pageUrl = String(location.href || '');
        this.addEventListener(
          'load',
          () => {
            try {
              const bodyText = readXhrBody(this);
              if (!bodyText) return;
              postIntercept({
                url,
                pageUrl,
                bodyText,
                at: Date.now(),
              });
            } catch (_error) {
              // ignore
            }
          },
          { once: true } as any,
        );
      }
    } catch (_error) {
      // ignore
    }
    return originalSend.apply(this, args);
  };
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://youtu.be/*', 'https://www.bilibili.com/*', 'https://bilibili.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    wrapFetch();
    wrapXhr();

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || data.__syncnos !== true || data.type !== 'SYNCNOS_VIDEO_META_REQUEST') return;
      const requestId = String((data as MetaRequestPayload).requestId || '').trim();
      if (!requestId) return;

      try {
        window.postMessage(
          {
            __syncnos: true,
            type: 'SYNCNOS_VIDEO_META_RESPONSE',
            requestId,
            meta: collectMetaForPage(),
          } satisfies MetaResponsePayload,
          '*',
        );
      } catch (_error) {
        // ignore
      }
    });
  },
});

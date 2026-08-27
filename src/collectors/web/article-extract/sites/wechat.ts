import { sanitizeWechatMediaUrl } from '@collectors/web/article-extract/url';

const WECHAT_EMBEDDED_VIDEO_CONTAINER_SELECTOR = [
  '.video_iframe',
  '[data-mpvid^="wxv_"]',
  '[vid^="wxv_"]',
  '[data-src*="video_player_tmpl"]',
  '[src*="video_player_tmpl"]',
  '.appmsg_video',
  '.page_video_wrapper',
].join(',');

const WECHAT_VIDEO_ID_RE = /\bwxv_[A-Za-z0-9_-]+\b/;

const WECHAT_RICH_MEDIA_NOISE_SELECTORS = [
  '#js_article_bottom_bar',
  '.bottom_bar_wrp',
  '.bottom_bar_interaction_wrp',
  '.interaction_bar__wrap',
  '.interaction_bar',
  '.sns_opr_btn_con',
  '.stream_friends_container',
  '.wx_follow_context',
  '.wx_bottom_modal_wrp',
  '.weui-half-screen-dialog',
  '.weui-mask',
  '.wx_bottom_modal_mask',
  '.wx_bottom_modal_mask_fixed',
  '.teleporter',
  '.weui-loadmore',
  '.wx_bottom_modal_msg_wrp',
];

function decodeUriComponentSafe(value: unknown) {
  const text = String(value || '').trim();
  if (!text || !text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch (_e) {
    return text;
  }
}

function findWechatVideoId(container: Element) {
  const nodes = [
    container,
    ...Array.from(container.querySelectorAll('[data-mpvid],[vid],[data-src],[src]')),
  ] as Element[];
  const attributes = ['data-mpvid', 'vid', 'data-src', 'src'];

  for (const node of nodes) {
    for (const attribute of attributes) {
      const raw = String(node.getAttribute(attribute) || '').trim();
      if (!raw) continue;
      const direct = raw.match(WECHAT_VIDEO_ID_RE)?.[0];
      if (direct) return direct;
      const decoded = decodeUriComponentSafe(raw);
      const decodedMatch = decoded.match(WECHAT_VIDEO_ID_RE)?.[0];
      if (decodedMatch) return decodedMatch;
    }
  }
  return '';
}

function findWechatVideoCoverUrl(container: Element, baseHref: string) {
  const candidates = [
    container.getAttribute('data-cover'),
    container.querySelector('[data-cover]')?.getAttribute('data-cover'),
    container.querySelector('video[poster]')?.getAttribute('poster'),
  ];

  for (const candidate of candidates) {
    const decoded = decodeUriComponentSafe(candidate);
    if (!decoded) continue;
    const sanitized = sanitizeWechatMediaUrl(decoded, baseHref);
    if (sanitized) return sanitized;
  }
  return '';
}

function buildWechatVideoPlayerUrl(videoId: string) {
  if (!WECHAT_VIDEO_ID_RE.test(videoId)) return '';
  return `https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=${encodeURIComponent(videoId)}`;
}

function createWechatVideoPlaceholder(container: Element, baseHref: string) {
  const doc = container.ownerDocument || document;
  const videoId = findWechatVideoId(container);
  const playerUrl = buildWechatVideoPlayerUrl(videoId);
  const coverUrl = findWechatVideoCoverUrl(container, baseHref);
  const block = doc.createElement('span');
  block.setAttribute('data-syncnos-origin', 'wechat-embedded-video');

  if (coverUrl) {
    const image = doc.createElement('img');
    image.setAttribute('src', coverUrl);
    image.setAttribute('alt', '微信视频');
    block.appendChild(image);
    block.appendChild(doc.createElement('br'));
  }

  if (playerUrl) {
    const labelLink = doc.createElement('a');
    labelLink.setAttribute('href', playerUrl);
    labelLink.textContent = '微信视频';
    block.appendChild(labelLink);
  } else {
    const label = doc.createElement('span');
    label.textContent = '微信视频';
    block.appendChild(label);
  }

  return block;
}

function listWechatArticleContentRoots(root: Element) {
  const roots: Element[] = [];
  if (typeof root.matches === 'function' && root.matches('#js_content')) roots.push(root);
  roots.push(...Array.from(root.querySelectorAll('#js_content')));
  return roots;
}

function normalizeWechatEmbeddedVideos(root: Element, baseHref: string) {
  for (const articleRoot of listWechatArticleContentRoots(root)) {
    const candidates = Array.from(articleRoot.querySelectorAll(WECHAT_EMBEDDED_VIDEO_CONTAINER_SELECTOR)) as Element[];
    if (!candidates.length) continue;

    const outermost = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)),
    );
    for (const container of outermost) {
      container.replaceWith(createWechatVideoPlaceholder(container, baseHref));
    }
  }
}

export function normalizeWechatRichMediaContent(root: Element, baseHref: string) {
  const cloned = root.cloneNode(true) as Element;
  normalizeWechatEmbeddedVideos(cloned, baseHref);

  const selector = WECHAT_RICH_MEDIA_NOISE_SELECTORS.join(',');
  if (selector) {
    try {
      cloned.querySelectorAll(selector).forEach((node: any) => node?.remove?.());
    } catch (_e) {
      // ignore
    }
  }

  try {
    cloned.querySelectorAll('[role="dialog"],[aria-modal="true"]').forEach((node: any) => node?.remove?.());
  } catch (_e) {
    // ignore
  }

  return cloned;
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dedupeUrls(urls: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const value = String(url || '').trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function isWechatShareMediaPage() {
  const hostname = String(location.hostname || '').toLowerCase();
  if (hostname !== 'mp.weixin.qq.com') return false;
  if (!document.querySelector('.share_content_page')) return false;
  if (!document.querySelector('#img_swiper_content')) return false;
  return true;
}

export function prepareWechatRichMediaDom() {
  const hostname = String(location.hostname || '').toLowerCase();
  if (hostname !== 'mp.weixin.qq.com') return;

  const wechatRoot = document.querySelector('#js_content') as any;
  if (wechatRoot) {
    wechatRoot.style.visibility = 'visible';
    wechatRoot.style.opacity = '1';
  }

  const noisyNodes = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
  noisyNodes.forEach((node: any) => node?.remove?.());
}

export function extractWechatShareMediaImageUrls(baseHref: string) {
  if (!isWechatShareMediaPage()) return [];

  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    const url = sanitizeWechatMediaUrl(value, baseHref);
    if (url) urls.push(url);
  };

  const swiperImgs = Array.from(document.querySelectorAll('.swiper_item_img img'));
  for (const img of swiperImgs) {
    const el = img as any;
    pushUrl(el.getAttribute?.('data-src') || el.getAttribute?.('src') || el.currentSrc || el.src || '');
  }

  if (urls.length < 2) {
    const thumbEls = Array.from(document.querySelectorAll('.swiper_indicator_list_pc [style*="background-image"]'));
    for (const el of thumbEls) {
      const style = String((el as any)?.getAttribute?.('style') || '');
      const match = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
      if (!match || !match[1]) continue;
      try {
        const thumbUrl = new URL(match[1], baseHref);
        thumbUrl.pathname = thumbUrl.pathname.replace(/\/300$/, '/0');
        pushUrl(thumbUrl.toString());
      } catch (_e) {
        // ignore
      }
    }
  }

  return dedupeUrls(urls);
}

export function buildWechatShareMediaGalleryHtml(baseHref: string) {
  const imageUrls = extractWechatShareMediaImageUrls(baseHref);
  if (!imageUrls.length) return '';

  const blocks = imageUrls
    .map(
      (url) =>
        `<p data-syncnos-origin="wechat-share-media-item"><img src="${escapeHtml(url)}" alt="" loading="lazy" style="max-width:100%;height:auto;display:block;" /></p>`,
    )
    .join('');
  return `<hr /><div data-syncnos-origin="wechat-share-media-gallery">${blocks}</div>`;
}

import { sanitizeWechatMediaUrl } from '@collectors/web/article-extract/url';

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

export function stripWechatRichMediaNoise(root: Element) {
  const cloned = root.cloneNode(true) as Element;
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

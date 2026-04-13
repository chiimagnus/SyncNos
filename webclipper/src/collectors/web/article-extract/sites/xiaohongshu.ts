import { normalizeText } from '@collectors/web/article-extract/url';

export function isXiaohongshuNotePage() {
  const hostname = String(location.hostname || '').toLowerCase();
  if (!hostname || !hostname.endsWith('xiaohongshu.com')) return false;
  return Boolean(document.querySelector('#noteContainer'));
}

export async function waitForXiaohongshuNoteHydrated() {
  if (!isXiaohongshuNotePage()) return;

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const root = document.querySelector('#noteContainer') as any;
    const text = root ? normalizeText(String((root as any).innerText || '')) : '';
    const imgCount = root ? Number(root.querySelectorAll?.('img')?.length || 0) : 0;
    if (text.length >= 80 || imgCount >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

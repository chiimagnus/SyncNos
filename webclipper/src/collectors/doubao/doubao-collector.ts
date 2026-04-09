import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import doubaoMarkdown from '@collectors/doubao/doubao-markdown.ts';

export function createDoubaoCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)doubao\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || '';
      if (p === '/chat' || p === '/chat/') return false;
      if (/^\/chat\/local/.test(p)) return false;
      return /^\/chat\/(?!local)[^/]+/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return (
      env.document.querySelector("[data-testid='message_list']") ||
      env.document.querySelector('main') ||
      env.document.body
    );
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  type InlineImageContext = {
    blobUrlCache: Map<string, { dataUrl: string; bytes: number }>;
    inlinedCount: number;
    inlinedBytes: number;
    warningFlags: Set<string>;
  };

  function createInlineImageContext(): InlineImageContext {
    return {
      blobUrlCache: new Map(),
      inlinedCount: 0,
      inlinedBytes: 0,
      warningFlags: new Set(),
    };
  }

  function isBlobUrl(url: unknown): boolean {
    const text = String(url || '').trim();
    return /^blob:/i.test(text);
  }

  function pickBlobUrlFromImg(img: any): string {
    if (!img) return '';
    const current = img.currentSrc ? String(img.currentSrc).trim() : '';
    if (isBlobUrl(current)) return current;
    const src = img.src ? String(img.src).trim() : img.getAttribute ? String(img.getAttribute('src') || '').trim() : '';
    if (isBlobUrl(src)) return src;
    const srcset = img.getAttribute ? String(img.getAttribute('srcset') || '').trim() : '';
    if (srcset) {
      const items = srcset
        .split(',')
        .map((s: any) => String(s || '').trim())
        .filter(Boolean);
      for (const item of items) {
        const url = item.split(/\s+/)[0] ? String(item.split(/\s+/)[0]).trim() : '';
        if (isBlobUrl(url)) return url;
      }
    }
    return '';
  }

  function extractBlobImageUrlsFromElement(element: ParentNode | null): string[] {
    if (!element || typeof (element as any).querySelectorAll !== 'function') return [];
    const images = Array.from((element as any).querySelectorAll('img'));
    const seen = new Set<string>();
    const output: string[] = [];
    for (const image of images) {
      const url = pickBlobUrlFromImg(image);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      output.push(url);
    }
    return output;
  }

  async function blobToDataUrl(blob: any): Promise<string> {
    const FileReaderCtor: any = (env.window as any)?.FileReader || (globalThis as any).FileReader;
    if (!FileReaderCtor) throw new Error('FileReader not available');
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReaderCtor();
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function inlineBlobImageUrl(blobUrl: string, ctx: InlineImageContext): Promise<string | null> {
    const cached = ctx.blobUrlCache.get(blobUrl);
    if (cached && cached.dataUrl) return cached.dataUrl;

    const fetchFn: any = (env.window as any)?.fetch || (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') {
      ctx.warningFlags.add('inline_images_fetch_unavailable');
      return null;
    }

    try {
      const response = await fetchFn(blobUrl);
      if (!response || response.ok === false) {
        ctx.warningFlags.add('inline_images_fetch_failed');
        return null;
      }

      const blob = await response.blob();
      const size = Number(blob?.size || 0);
      const type = String(blob?.type || '');
      if (!type || !/^image\//i.test(type)) {
        ctx.warningFlags.add('inline_images_non_image_blob');
        return null;
      }
      if (size <= 0) {
        ctx.warningFlags.add('inline_images_empty_blob');
        return null;
      }

      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
        ctx.warningFlags.add('inline_images_encode_failed');
        return null;
      }

      ctx.blobUrlCache.set(blobUrl, { dataUrl, bytes: size });
      ctx.inlinedCount += 1;
      ctx.inlinedBytes += size;
      return dataUrl;
    } catch (_e) {
      ctx.warningFlags.add('inline_images_fetch_failed');
      return null;
    }
  }

  async function extractImageUrlsIncludingBlobImages(
    element: ParentNode | null,
    ctx: InlineImageContext,
  ): Promise<string[]> {
    const httpUrls = extractImageUrlsFromElement(element);
    const blobUrls = extractBlobImageUrlsFromElement(element);
    if (!blobUrls.length) return httpUrls;

    const dataUrls: string[] = [];
    for (const blobUrl of blobUrls) {
      const dataUrl = await inlineBlobImageUrl(blobUrl, ctx);
      if (dataUrl) dataUrls.push(dataUrl);
    }

    const merged = httpUrls.concat(dataUrls);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of merged) {
      const t = String(url || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  async function collectMessages(ctx: InlineImageContext): Promise<any[]> {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers: any[] = Array.from(env.document.querySelectorAll("[data-testid='union_message']")) as any[];
    if (!containers.length) return [];

    const out = [];
    let seq = 0;
    for (const c of containers) {
      const sendMessage = c.querySelector("[data-testid='send_message']");
      if (sendMessage) {
        const tEl = sendMessage.querySelector("[data-testid='message_text_content']") || sendMessage;
        const text = env.normalize.normalizeText((tEl as any).innerText || tEl.textContent || '');
        const imageUrls = await extractImageUrlsIncludingBlobImages(sendMessage, ctx);
        if (text || imageUrls.length) {
          const contentText = text || '';
          const contentMarkdown = appendImageMarkdown(contentText, imageUrls, { allowDataImageUrls: true });
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: 'user', contentText, sequence: seq }),
            role: 'user',
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now(),
          });
          seq += 1;
        }
      }

      const recv = c.querySelector("[data-testid='receive_message']");
      if (recv) {
        const all: any[] = Array.from(recv.querySelectorAll("[data-testid='message_text_content']")) as any[];
        const textEl = all.find((el: any) => !el.closest("[data-testid='think_block_collapse']")) || recv;
        const fallbackText = env.normalize.normalizeText((textEl as any).innerText || textEl.textContent || '');
        const text =
          typeof doubaoMarkdown.extractAssistantText === 'function'
            ? doubaoMarkdown.extractAssistantText(textEl) || fallbackText
            : fallbackText;
        const imageUrls = await extractImageUrlsIncludingBlobImages(recv, ctx);
        if (text || imageUrls.length) {
          const contentText = text || '';
          const baseMarkdown =
            typeof doubaoMarkdown.extractAssistantMarkdown === 'function'
              ? doubaoMarkdown.extractAssistantMarkdown(textEl) || contentText
              : contentText;
          const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls, { allowDataImageUrls: true });
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: 'assistant', contentText, sequence: seq }),
            role: 'assistant',
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now(),
          });
          seq += 1;
        }
      }
    }
    return out;
  }

  async function capture(): Promise<any> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const ctx = createInlineImageContext();
    const messages = await collectMessages(ctx);
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'doubao',
        conversationKey: findConversationKey(),
        title: env.document.title || 'Doubao',
        url: env.location.href,
        warningFlags: Array.from(ctx.warningFlags),
        lastCapturedAt: Date.now(),
      },
      messages,
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: 'doubao', matches, collector };
}

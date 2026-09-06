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
      env.document.querySelector("[aria-label='doc_editor']") ||
      env.document.querySelector("[class*='message-list-']") ||
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

  function detectModernRole(messageRow: any): 'user' | 'assistant' | null {
    if (!messageRow) return null;

    const host = messageRow.closest?.('.flex.flex-col.flex-grow') || messageRow.parentElement || messageRow;
    const hasSendActionBar = !!host?.querySelector?.("[data-foundation-type='send-message-action-bar']");
    const hasReceiveActionBar = !!host?.querySelector?.("[data-foundation-type='receive-message-action-bar']");
    if (hasSendActionBar && !hasReceiveActionBar) return 'user';
    if (hasReceiveActionBar && !hasSendActionBar) return 'assistant';

    const classText = String(messageRow.className || '');
    if (/\bjustify-end\b/.test(classText)) return 'user';

    if (messageRow.closest?.("[data-copy-telemetry='right_click_copy']")) return 'assistant';

    const hasUserBubble = !!messageRow.querySelector?.(".bg-g-send-msg-bubble-bg, [class*='send-msg-bubble']");
    if (hasUserBubble) return 'user';

    const hasAssistantMarkdown = !!messageRow.querySelector?.('.flow-markdown-body, [class*="flow-markdown-body"]');
    if (hasAssistantMarkdown) return 'assistant';

    return null;
  }

  async function collectModernMessages(ctx: InlineImageContext): Promise<any[]> {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const messageRows: any[] = Array.from(root.querySelectorAll('[data-message-id]')) as any[];
    if (!messageRows.length) return [];

    const out = [];
    const seenMessageIds = new Set<string>();
    let seq = 0;
    for (const row of messageRows) {
      const messageId = String(row.getAttribute?.('data-message-id') || '').trim();
      if (messageId && seenMessageIds.has(messageId)) continue;
      if (messageId) seenMessageIds.add(messageId);

      const role = detectModernRole(row);
      if (!role) continue;

      const textEl =
        role === 'user'
          ? row.querySelector(
              "[data-testid='message_text_content'], .bg-g-send-msg-bubble-bg, [class*='send-msg-bubble']",
            ) || row
          : row.querySelector(
              "[data-testid='message_text_content'], .flow-markdown-body, [class*='flow-markdown-body']",
            ) || row;

      const fallbackText = env.normalize.normalizeText((textEl as any).innerText || textEl.textContent || '');
      const text =
        role === 'assistant' && typeof doubaoMarkdown.extractAssistantText === 'function'
          ? doubaoMarkdown.extractAssistantText(textEl) || fallbackText
          : fallbackText;

      const imageScope = role === 'assistant' ? row.closest?.("[data-copy-telemetry='right_click_copy']") || row : row;
      const imageUrls = await extractImageUrlsIncludingBlobImages(imageScope, ctx);
      if (!text && !imageUrls.length) continue;

      const contentText = text || '';
      const baseMarkdown =
        role === 'assistant' && typeof doubaoMarkdown.extractAssistantMarkdown === 'function'
          ? doubaoMarkdown.extractAssistantMarkdown(textEl) || contentText
          : contentText;
      const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls, { allowDataImageUrls: true });

      out.push({
        messageKey: env.normalize.makeFallbackMessageKey({ role, text: contentText, sequence: seq }),
        role,
        contentMarkdown,
        sequence: seq,
        updatedAt: Date.now(),
      });
      seq += 1;
    }

    return out;
  }

  async function collectMessages(ctx: InlineImageContext): Promise<any[]> {
    return collectModernMessages(ctx);
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

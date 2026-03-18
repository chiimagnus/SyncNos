import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import geminiMarkdown from './gemini-markdown.ts';

export function createGeminiCollectorDef(env: CollectorEnv): CollectorDefinition {
  const INLINE_BLOB_IMAGES_MAX_COUNT = 12;
  const INLINE_BLOB_IMAGE_MAX_BYTES = 2_000_000;
  const INLINE_BLOB_IMAGES_MAX_TOTAL_BYTES = 8_000_000;
  const DEEP_RESEARCH_MIN_TEXT_LENGTH = 120;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      env.window.setTimeout(resolve, Math.max(0, ms));
    });
  }

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)gemini\.google\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || "";
      if (p === "/app") return false;
      if (/^\/gem\/[^/]+$/.test(p)) return false;
      return /^\/app\/[^/]+$/.test(p) || /^\/gem\/[^/]+\/[^/]+$/.test(p) || /\/app\/[^/]+$/.test(p) || /\/gem\/[^/]+\/[^/]+$/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector("#chat-history") || env.document.querySelector("main") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function normalizeTitle(value: any): any {
    const text = value == null ? "" : String(value);
    return env.normalize.normalizeText(text);
  }

  function extractConversationTitle(): any {
    const selectors = [
      "[data-test-id='conversation-title']",
      ".conversation-title-container .conversation-title-column [class*='gds-title']",
      ".conversation-title-container .conversation-title-column"
    ];
    for (const selector of selectors) {
      const el = env.document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle((el as any).textContent || (el as any).innerText || "");
      if (title) return title;
    }
    const pageTitle = normalizeTitle(env.document.title || "");
    return pageTitle || "Gemini";
  }

  function extractAssistantMarkdown(node: any, fallbackText: any): any {
    if (typeof geminiMarkdown.extractAssistantMarkdown === "function") {
      const markdown = geminiMarkdown.extractAssistantMarkdown(node);
      if (markdown) return markdown;
    }
    return fallbackText || "";
  }

  function extractAssistantText(node: any): any {
    if (typeof geminiMarkdown.extractAssistantText === "function") {
      const text = geminiMarkdown.extractAssistantText(node);
      if (text) return text;
    }
    return extractTextExcludingNonContent(node);
  }

  function extractTextExcludingNonContent(node: any): string {
    if (!node) return "";
    try {
      const cloned = node.cloneNode ? node.cloneNode(true) : null;
      if (cloned && typeof cloned.querySelectorAll === "function") {
        cloned
          .querySelectorAll(
            ".cdk-visually-hidden, .table-footer, [hidden], [hide-from-message-actions], [aria-hidden='true'], svg, path, textarea, input, select, option, script, style, button"
          )
          .forEach((el: any) => {
            try {
              el.remove();
            } catch (_e) {
              // ignore
            }
          });
      }
      const raw = cloned ? ((cloned as any).innerText || (cloned as any).textContent || "") : (node.innerText || node.textContent || "");
      return env.normalize.normalizeText(raw);
    } catch (_e) {
      const raw = node ? (node.innerText || node.textContent || "") : "";
      return env.normalize.normalizeText(raw);
    }
  }

  function normalizeComparableText(value: unknown): string {
    return env.normalize.normalizeText(String(value || '')).toLowerCase();
  }

  function findDeepResearchChipTitle(node: ParentNode | null): string {
    if (!node || typeof (node as any).querySelector !== 'function') return '';
    const selectors = [
      "immersive-entry-chip [data-test-id='title-text']",
      "deep-research-entry-chip-content [data-test-id='title-text']",
      "immersive-entry-chip .title-text",
      "deep-research-entry-chip-content .title-text",
    ];
    for (const selector of selectors) {
      const el = (node as any).querySelector(selector);
      if (!el) continue;
      const title = env.normalize.normalizeText((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }
    return '';
  }

  function findDeepResearchTrigger(node: ParentNode | null): HTMLElement | null {
    if (!node || typeof (node as any).querySelector !== 'function') return null;
    const selectors = [
      "immersive-entry-chip [data-test-id='container'].clickable",
      "immersive-entry-chip [data-test-id='container']",
      "deep-research-entry-chip-content [data-test-id='container'].clickable",
      "deep-research-entry-chip-content [data-test-id='container']",
      "immersive-entry-chip .container.clickable",
      "deep-research-entry-chip-content .container.clickable",
      "immersive-entry-chip [data-test-id='title-text']",
      "deep-research-entry-chip-content [data-test-id='title-text']",
    ];
    for (const selector of selectors) {
      const el = (node as any).querySelector(selector) as HTMLElement | null;
      if (el) return el;
    }
    return null;
  }

  function findDeepResearchPanels(): Element[] {
    const selectors = ['deep-research-immersive-panel', 'immersive-panel deep-research-immersive-panel'];
    for (const selector of selectors) {
      const nodes = Array.from(env.document.querySelectorAll(selector));
      if (nodes.length) return nodes;
    }
    return [];
  }

  function extractDeepResearchPanelTitle(panel: ParentNode | null): string {
    if (!panel || typeof (panel as any).querySelector !== 'function') return '';
    const selectors = [
      "toolbar h2.title-text",
      "[data-test-id='message-content'] h1",
      '#extended-response-markdown-content h1',
      '.markdown-main-panel h1',
    ];
    for (const selector of selectors) {
      const el = (panel as any).querySelector(selector);
      if (!el) continue;
      const title = env.normalize.normalizeText((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }
    return '';
  }

  function findDeepResearchPanelByTitle(expectedTitle: string): Element | null {
    const panels = findDeepResearchPanels();
    if (!panels.length) return null;

    const normalizedExpected = normalizeComparableText(expectedTitle);
    if (!normalizedExpected) return panels[0] || null;

    for (const panel of panels) {
      const panelTitle = normalizeComparableText(extractDeepResearchPanelTitle(panel));
      if (panelTitle && panelTitle === normalizedExpected) return panel;
    }
    return null;
  }

  function extractDeepResearchPanelContent(panel: Element | null): { title: string; contentText: string; contentMarkdown: string; contentRoot: ParentNode } | null {
    if (!panel) return null;
    const title = extractDeepResearchPanelTitle(panel);
    const contentText = extractAssistantText(panel);
    if (!contentText || contentText.length < DEEP_RESEARCH_MIN_TEXT_LENGTH) return null;
    const contentMarkdown = extractAssistantMarkdown(panel, contentText) || contentText;
    return {
      title,
      contentText,
      contentMarkdown,
      contentRoot: panel,
    };
  }

  async function openDeepResearchPanel(trigger: HTMLElement | null): Promise<void> {
    if (!trigger) return;
    if (typeof trigger.click === 'function') {
      trigger.click();
      return;
    }

    const MouseEventCtor = (env.window as any).MouseEvent;
    if (typeof trigger.dispatchEvent === 'function' && MouseEventCtor) {
      trigger.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
    }
  }

  async function waitForDeepResearchPanel(expectedTitle: string, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<Element | null> {
    const timeoutMs = Math.max(120, Number(options.timeoutMs) || 2_000);
    const pollMs = Math.max(20, Number(options.pollMs) || 80);
    const start = Date.now();

    while ((Date.now() - start) <= timeoutMs) {
      const panel = findDeepResearchPanelByTitle(expectedTitle);
      if (extractDeepResearchPanelContent(panel)) return panel;
      await sleep(pollMs);
    }

    return null;
  }

  async function resolveDeepResearchContent(
    node: ParentNode | null,
    options: { manual?: boolean } = {},
  ): Promise<{ title: string; contentText: string; contentMarkdown: string; contentRoot: ParentNode } | null> {
    const chipTitle = findDeepResearchChipTitle(node);
    if (!chipTitle) return null;

    const openPanel = findDeepResearchPanelByTitle(chipTitle);
    const immediate = extractDeepResearchPanelContent(openPanel);
    if (immediate) return immediate;

    if (!options.manual) return null;

    const trigger = findDeepResearchTrigger(node);
    if (!trigger) return null;

    await openDeepResearchPanel(trigger);
    const panel = await waitForDeepResearchPanel(chipTitle);
    return extractDeepResearchPanelContent(panel);
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
    const src = img.src
      ? String(img.src).trim()
      : img.getAttribute
        ? String(img.getAttribute('src') || '').trim()
        : '';
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

    if (ctx.inlinedCount >= INLINE_BLOB_IMAGES_MAX_COUNT) {
      ctx.warningFlags.add('inline_images_limit_reached');
      return null;
    }
    if (ctx.inlinedBytes >= INLINE_BLOB_IMAGES_MAX_TOTAL_BYTES) {
      ctx.warningFlags.add('inline_images_total_bytes_limit_reached');
      return null;
    }

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
      if (size > INLINE_BLOB_IMAGE_MAX_BYTES) {
        ctx.warningFlags.add('inline_images_single_too_large');
        return null;
      }
      if ((ctx.inlinedBytes + size) > INLINE_BLOB_IMAGES_MAX_TOTAL_BYTES) {
        ctx.warningFlags.add('inline_images_total_bytes_limit_reached');
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

  async function extractImageUrlsIncludingBlobImages(element: ParentNode | null, ctx: InlineImageContext): Promise<string[]> {
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

  async function collectMessages(ctx: InlineImageContext, options: { manual?: boolean } = {}): Promise<any[]> {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const blocks: any[] = Array.from(root.querySelectorAll(".conversation-container")) as any[];
    if (!blocks.length) return [];

    const out: any[] = [];
    let seq = 0;
    for (const b of blocks) {
      const userRoot = b.querySelector("user-query") || b.querySelector("[data-test-id='user-message']") || null;
      if (userRoot) {
        const userTextEl = userRoot.querySelector ? (userRoot.querySelector(".query-text") || userRoot) : userRoot;
        const text = extractTextExcludingNonContent(userTextEl);
        const imageUrls = await extractImageUrlsIncludingBlobImages(userRoot, ctx);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const contentMarkdown = appendImageMarkdown(contentText, imageUrls, { allowDataImageUrls: true });
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: "user", contentText, sequence: seq }),
            role: "user",
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }

      const model = b.querySelector("model-response") || b.querySelector("model-response .model-response-text") || null;
      if (model) {
        const deepResearch = await resolveDeepResearchContent(model, { manual: options.manual === true });
        const text = deepResearch?.contentText || extractAssistantText(model);
        const imageScope = (deepResearch?.contentRoot || model) as ParentNode | null;
        const imageUrls = await extractImageUrlsIncludingBlobImages(imageScope, ctx);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMarkdown = deepResearch?.contentMarkdown || extractAssistantMarkdown(model, contentText);
          const contentMarkdown = appendImageMarkdown(baseMarkdown || contentText, imageUrls, { allowDataImageUrls: true });
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: "assistant", contentText, sequence: seq }),
            role: "assistant",
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }
    }
    return out;
  }

  async function capture(options: any = {}): Promise<any> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const ctx = createInlineImageContext();
    const messages = await collectMessages(ctx, { manual: options?.manual === true });
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "gemini",
        conversationKey: findConversationKey(),
        title: extractConversationTitle(),
        url: env.location.href,
        warningFlags: Array.from(ctx.warningFlags),
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector = {
    capture,
    getRoot: getConversationRoot,
    __test: {
      collectMessages: async (options: { manual?: boolean } = {}) => collectMessages(createInlineImageContext(), options),
      extractAssistantMarkdown,
      extractAssistantText,
      findDeepResearchChipTitle,
      extractDeepResearchPanelTitle,
      resolveDeepResearchContent,
    }
  };

  return { id: "gemini", matches, collector };
}

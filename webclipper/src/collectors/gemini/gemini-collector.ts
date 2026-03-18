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

  function extractDeepResearchTitleFromAriaLabel(label: string): string {
    const text = env.normalize.normalizeText(label || '');
    if (!text) return '';
    const m = text.match(/《([^》]{1,220})》/);
    if (m && m[1]) return env.normalize.normalizeText(m[1]);
    return '';
  }

  function findDeepResearchChipTitle(node: ParentNode | null): string {
    if (!node || typeof (node as any).querySelector !== 'function') return '';
    const selectors = [
      "immersive-entry-chip [data-test-id='title-text']",
      "immersive-entry-chip [data-test-id='artifact-text']",
      "deep-research-entry-chip-content [data-test-id='title-text']",
      "default-entry-chip-content [data-test-id='artifact-text']",
      "immersive-entry-chip .title-text",
      "deep-research-entry-chip-content .title-text",
    ];
    for (const selector of selectors) {
      const el = (node as any).querySelector(selector);
      if (!el) continue;
      const title = env.normalize.normalizeText((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }

    // Fallback: parse from the "打开" button aria-label, e.g. 在 Canvas 中打开《...》
    const btn = (node as any).querySelector?.("button[data-test-id='view-report-button']") as HTMLElement | null;
    if (btn) {
      const label = String((btn as any).getAttribute?.('aria-label') || '').trim();
      const parsed = extractDeepResearchTitleFromAriaLabel(label);
      if (parsed) return parsed;
    }
    return '';
  }

  function findDeepResearchTrigger(node: ParentNode | null): HTMLElement | null {
    if (!node || typeof (node as any).querySelector !== 'function') return null;
    const selectors = [
      "immersive-entry-chip button[data-test-id='view-report-button']",
      "button[data-test-id='view-report-button']",
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

  function findDeepResearchChips(node: ParentNode | null): Element[] {
    if (!node || typeof (node as any).querySelectorAll !== 'function') return [];
    const chips = Array.from((node as any).querySelectorAll('immersive-entry-chip')) as Element[];
    return chips.filter(Boolean);
  }

  function findDeepResearchChipTitleFromChip(chip: ParentNode | null): string {
    if (!chip || typeof (chip as any).querySelector !== 'function') return '';
    const selectors = [
      "[data-test-id='title-text']",
      "[data-test-id='artifact-text']",
      '.title-text',
    ];
    for (const selector of selectors) {
      const el = (chip as any).querySelector(selector);
      if (!el) continue;
      const title = env.normalize.normalizeText((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }
    const btn = (chip as any).querySelector?.("button[data-test-id='view-report-button']") as HTMLElement | null;
    if (btn) {
      const label = String((btn as any).getAttribute?.('aria-label') || '').trim();
      const parsed = extractDeepResearchTitleFromAriaLabel(label);
      if (parsed) return parsed;
    }
    return '';
  }

  function findDeepResearchTriggerFromChip(chip: ParentNode | null): HTMLElement | null {
    if (!chip || typeof (chip as any).querySelector !== 'function') return null;
    const selectors = [
      "button[data-test-id='view-report-button']",
      "[data-test-id='container'].clickable",
      "[data-test-id='container']",
      '.container.clickable',
      "[data-test-id='title-text']",
      "[data-test-id='artifact-text']",
    ];
    for (const selector of selectors) {
      const el = (chip as any).querySelector(selector) as HTMLElement | null;
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

  function isHiddenByAttributes(el: Element): boolean {
    try {
      if ((el as any).hidden) return true;
      const ariaHidden = String((el as any).getAttribute?.('aria-hidden') || '').trim().toLowerCase();
      if (ariaHidden === 'true') return true;
      const style = String((el as any).getAttribute?.('style') || '').toLowerCase();
      if (style.includes('display:none') || style.includes('display: none')) return true;
      if (style.includes('visibility:hidden') || style.includes('visibility: hidden')) return true;
      if (style.includes('opacity:0') || style.includes('opacity: 0')) return true;
      return false;
    } catch (_e) {
      return false;
    }
  }

  function pickActiveDeepResearchPanel(): Element | null {
    const panels = findDeepResearchPanels();
    if (!panels.length) return null;
    const visible = panels.filter((p) => p && !isHiddenByAttributes(p));
    return (visible.length ? visible[visible.length - 1] : panels[panels.length - 1]) || null;
  }

  function extractDeepResearchPanelIds(panel: ParentNode | null): { reportId: string; responseId: string } {
    const empty = { reportId: '', responseId: '' };
    if (!panel) return empty;

    const tryExtract = (input: unknown): { reportId: string; responseId: string } => {
      const text = String(input || '');
      const mReport = text.match(/\br_[0-9a-f]{16}\b/);
      const mResp = text.match(/\brc_[0-9a-f]{16}\b/);
      return { reportId: mReport ? mReport[0] : '', responseId: mResp ? mResp[0] : '' };
    };

    const exportBtn = (panel as any).querySelector?.("button[data-test-id='export-menu-button']") as Element | null;
    const exportJslog = exportBtn ? String((exportBtn as any).getAttribute?.('jslog') || '') : '';
    const exportIds = tryExtract(exportJslog);
    if (exportIds.reportId || exportIds.responseId) return exportIds;

    const panelJslog = String((panel as any).getAttribute?.('jslog') || '');
    const panelIds = tryExtract(panelJslog);
    if (panelIds.reportId || panelIds.responseId) return panelIds;

    return empty;
  }

  function extractDeepResearchPanelSignature(panel: Element | null): string {
    if (!panel) return '';
    const ids = extractDeepResearchPanelIds(panel);
    if (ids.reportId || ids.responseId) return `id:${ids.reportId || ''}:${ids.responseId || ''}`;
    const title = normalizeComparableText(extractDeepResearchPanelTitle(panel));
    const content = env.normalize.normalizeText(extractTextExcludingNonContent(panel)).slice(0, 1200);
    const hash = typeof env.normalize.fnv1a32 === 'function' ? env.normalize.fnv1a32(`${title}|${content}`) : '';
    return hash ? `hash:${hash}` : '';
  }

  function getCurrentDeepResearchPanelSignature(): string {
    return extractDeepResearchPanelSignature(pickActiveDeepResearchPanel());
  }

  function isDeepResearchChipOpen(chip: ParentNode | null): boolean {
    if (!chip || typeof (chip as any).querySelector !== 'function') return false;
    const container = (chip as any).querySelector?.("[data-test-id='container']") as HTMLElement | null;
    const className = String((container as any)?.className || '').toLowerCase();
    if (className.includes('is-open')) return true;
    const ariaExpanded = String((container as any)?.getAttribute?.('aria-expanded') || '').trim().toLowerCase();
    if (ariaExpanded === 'true') return true;
    return false;
  }

  function findAnyOpenDeepResearchChipTrigger(blocks: any[]): HTMLElement | null {
    for (const b of blocks) {
      const model = b?.querySelector?.('model-response') || null;
      if (!model) continue;
      const chips = findDeepResearchChips(model);
      for (const chip of chips) {
        if (!isDeepResearchChipOpen(chip)) continue;
        const trigger = findDeepResearchTriggerFromChip(chip);
        if (trigger) return trigger;
      }
    }
    return null;
  }

  function findDeepResearchPanelCloseButton(panel: ParentNode | null): HTMLElement | null {
    if (!panel || typeof (panel as any).querySelector !== 'function') return null;
    const selectors = [
      "button[data-test-id='close-button']",
      "button[aria-label*='关闭']",
      "button[aria-label*='返回']",
      "button[aria-label*='Close']",
      "button[aria-label*='Back']",
      "button mat-icon[fonticon='close']",
      "button mat-icon[fonticon='arrow_back']",
      "button mat-icon[fonticon='chevron_left']",
    ];
    for (const selector of selectors) {
      const el = (panel as any).querySelector(selector) as HTMLElement | null;
      if (!el) continue;
      // If a mat-icon was selected, click its nearest button.
      if (String((el as any).tagName || '').toLowerCase() === 'mat-icon') {
        const btn = (el as any).closest?.('button') as HTMLElement | null;
        if (btn) return btn;
      }
      return el;
    }
    return null;
  }

  async function restoreDeepResearchPanelStateBestEffort(input: {
    blocks: any[];
    jobs: DeepResearchJob[];
    initialSignature: string;
    initialHadPanel: boolean;
  }): Promise<void> {
    const initialSig = String(input.initialSignature || '').trim();
    let currentSig = getCurrentDeepResearchPanelSignature();

    if (input.initialHadPanel && initialSig) {
      if (currentSig && currentSig === initialSig) return;
      // Try to restore by clicking jobs until the signature matches.
      for (const job of input.jobs) {
        currentSig = getCurrentDeepResearchPanelSignature();
        if (currentSig && currentSig === initialSig) return;
        const trigger = resolveDeepResearchTriggerFromJob(input.blocks, job);
        if (!trigger) continue;
        const beforeSig = getCurrentDeepResearchPanelSignature();
        await openDeepResearchPanel(trigger);
        const panel = await waitForDeepResearchPanelSwitch(beforeSig, { timeoutMs: 4_000, expectedTitle: job.title || '' });
        const sig = extractDeepResearchPanelSignature(panel);
        if (sig && sig === initialSig) return;
      }
      return;
    }

    // Initially no panel: try to close whatever is open now (best-effort).
    const panel = pickActiveDeepResearchPanel();
    if (!panel) return;

    const openChipTrigger = findAnyOpenDeepResearchChipTrigger(input.blocks);
    if (openChipTrigger) {
      const beforeSig = getCurrentDeepResearchPanelSignature();
      await openDeepResearchPanel(openChipTrigger);
      const afterSig = getCurrentDeepResearchPanelSignature();
      if (beforeSig && !afterSig) return;
    }

    const closeBtn = findDeepResearchPanelCloseButton(panel);
    if (closeBtn) {
      await openDeepResearchPanel(closeBtn);
      return;
    }

    // Escape is a common dismiss affordance for overlays.
    try {
      const KeyboardEventCtor = (env.window as any).KeyboardEvent;
      if (KeyboardEventCtor) {
        env.document.dispatchEvent(new KeyboardEventCtor('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      }
    } catch (_e) {
      // ignore
    }
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

  function scrollIntoViewSafe(el: Element | null) {
    try {
      (el as any)?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    } catch (_e) {
      try {
        (el as any)?.scrollIntoView?.();
      } catch (_e2) {
        // ignore
      }
    }
  }

  function clickLikeUser(el: HTMLElement | null) {
    if (!el) return;
    scrollIntoViewSafe(el);
    const PointerEventCtor = (env.window as any).PointerEvent;
    const MouseEventCtor = (env.window as any).MouseEvent;

    const dispatch = (type: string) => {
      try {
        if (PointerEventCtor) {
          el.dispatchEvent(new PointerEventCtor(type, { bubbles: true, cancelable: true, pointerType: 'mouse' }));
          return;
        }
        if (MouseEventCtor) {
          el.dispatchEvent(new MouseEventCtor(type, { bubbles: true, cancelable: true }));
        }
      } catch (_e) {
        // ignore
      }
    };

    dispatch('pointerdown');
    dispatch('mousedown');
    try {
      el.focus?.();
    } catch (_e) {
      // ignore
    }
    if (typeof el.click === 'function') {
      el.click();
    } else {
      dispatch('click');
    }
    dispatch('mouseup');
    dispatch('pointerup');
  }

  async function openDeepResearchPanel(trigger: HTMLElement | null): Promise<void> {
    if (!trigger) return;
    clickLikeUser(trigger);
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

  type DeepResearchJob = {
    jobKey: string;
    blockIndex: number;
    chipIndex: number;
    title: string;
    blockId: string;
  };

  function buildDeepResearchJobs(blocks: any[]): DeepResearchJob[] {
    const out: DeepResearchJob[] = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const b = blocks[blockIndex];
      const model = b?.querySelector?.('model-response') || null;
      if (!model) continue;

      const chips = findDeepResearchChips(model);
      if (!chips.length) continue;

      let chipSeq = 0;
      for (const chip of chips) {
        const trigger = findDeepResearchTriggerFromChip(chip);
        if (!trigger) continue;
        const title = findDeepResearchChipTitleFromChip(chip) || '';
        const blockId = String((b as any)?.id || '').trim();
        const base = `${blockId || `idx:${blockIndex}`}|chip:${chipSeq}|${title}`;
        const hash = typeof env.normalize.fnv1a32 === 'function' ? env.normalize.fnv1a32(base) : '';
        const jobKey = hash ? `gemini_dr_${hash}` : `gemini_dr_${blockIndex}_${chipSeq}`;
        out.push({ jobKey, blockIndex, chipIndex: chipSeq, title, blockId });
        chipSeq += 1;
      }
    }
    return out;
  }

  function resolveDeepResearchTriggerFromJob(blocks: any[], job: DeepResearchJob): HTMLElement | null {
    const block =
      (job.blockId && env.document.getElementById(job.blockId))
        ? env.document.getElementById(job.blockId)
        : blocks[job.blockIndex];
    if (!block) return null;
    const model = (block as any).querySelector?.('model-response') || null;
    if (!model) return null;
    const chips = findDeepResearchChips(model);
    const chip = chips[job.chipIndex] || null;
    return findDeepResearchTriggerFromChip(chip);
  }

  async function waitForDeepResearchPanelSwitch(
    previousSignature: string,
    options: { timeoutMs?: number; pollMs?: number; expectedTitle?: string } = {},
  ): Promise<Element | null> {
    const timeoutMs = Math.max(200, Number(options.timeoutMs) || 8_000);
    const pollMs = Math.max(30, Number(options.pollMs) || 80);
    const expectedNorm = normalizeComparableText(options.expectedTitle || '');
    const start = Date.now();

    while ((Date.now() - start) <= timeoutMs) {
      const panel = pickActiveDeepResearchPanel();
      const content = extractDeepResearchPanelContent(panel);
      if (content) {
        const sig = extractDeepResearchPanelSignature(panel);
        const titleNorm = normalizeComparableText(content.title || '');
        const titleOk = !expectedNorm || !titleNorm ? true : titleNorm.includes(expectedNorm) || expectedNorm.includes(titleNorm);
        if (titleOk && sig && sig !== previousSignature) return panel;
      }
      await sleep(pollMs);
    }
    return null;
  }

  async function crawlDeepResearchJobsManual(
    blocks: any[],
    jobs: DeepResearchJob[],
  ): Promise<Map<string, { ok: boolean; title: string; contentText: string; contentMarkdown: string; contentRoot: ParentNode; error?: string }>> {
    const out = new Map<string, { ok: boolean; title: string; contentText: string; contentMarkdown: string; contentRoot: ParentNode; error?: string }>();
    for (const job of jobs) {
      // If the report is already open, extract immediately instead of waiting for a signature change.
      const activePanel = pickActiveDeepResearchPanel();
      const activeContent = extractDeepResearchPanelContent(activePanel);
      if (activeContent) {
        const expectedNorm = normalizeComparableText(job.title || '');
        const titleNorm = normalizeComparableText(activeContent.title || '');
        const titleOk = !expectedNorm || !titleNorm ? false : titleNorm.includes(expectedNorm) || expectedNorm.includes(titleNorm);
        if (titleOk) {
          out.set(job.jobKey, { ok: true, ...activeContent });
          continue;
        }
      }

      const trigger = resolveDeepResearchTriggerFromJob(blocks, job);
      if (!trigger) {
        out.set(job.jobKey, { ok: false, title: job.title || '', contentText: '', contentMarkdown: '', contentRoot: env.document.body, error: 'trigger_not_found' });
        continue;
      }

      const beforePanel = pickActiveDeepResearchPanel();
      const beforeSig = extractDeepResearchPanelSignature(beforePanel);

      await openDeepResearchPanel(trigger);
      const panel = await waitForDeepResearchPanelSwitch(beforeSig, { timeoutMs: 8_000, expectedTitle: job.title || '' });
      const content = extractDeepResearchPanelContent(panel);
      if (!content) {
        out.set(job.jobKey, { ok: false, title: job.title || '', contentText: '', contentMarkdown: '', contentRoot: env.document.body, error: 'panel_extract_failed' });
        continue;
      }
      out.set(job.jobKey, { ok: true, ...content });
    }
    return out;
  }

  function mergeDeepResearchResults(
    input: {
      baseText: string;
      baseMarkdown: string;
      jobs: DeepResearchJob[];
      results: Map<string, { ok: boolean; title: string; contentText: string; contentMarkdown: string; contentRoot: ParentNode; error?: string }>;
    },
  ): { contentText: string; contentMarkdown: string } {
    const baseText = env.normalize.normalizeText(input.baseText || '');
    const baseMarkdown = String(input.baseMarkdown || '').trim() ? String(input.baseMarkdown) : baseText;

    const sections: string[] = [];
    const textParts: string[] = [];
    for (const job of input.jobs) {
      const res = input.results.get(job.jobKey);
      if (res && res.ok) {
        const title = env.normalize.normalizeText(res.title || job.title || '');
        const md = String(res.contentMarkdown || '').trim() || env.normalize.normalizeText(res.contentText || '');
        const mdBlock = title ? `\n\n## Deep Research: ${title}\n\n${md}` : `\n\n## Deep Research\n\n${md}`;
        sections.push(mdBlock);
        const textBlock = env.normalize.normalizeText(res.contentText || '');
        if (textBlock) textParts.push(title ? `${title}\n${textBlock}` : textBlock);
        continue;
      }

      const title = env.normalize.normalizeText(job.title || '');
      const err = env.normalize.normalizeText(res?.error || 'failed');
      sections.push(title ? `\n\n## Deep Research: ${title}\n\n(未抓到全文: ${err})` : `\n\n## Deep Research\n\n(未抓到全文: ${err})`);
      textParts.push(title ? `${title}\n(未抓到全文: ${err})` : `(未抓到全文: ${err})`);
    }

    const mergedMarkdown = baseMarkdown + (sections.length ? `\n\n---\n${sections.join('\n\n---\n')}` : '');
    const mergedText = baseText + (textParts.length ? `\n\n${textParts.join('\n\n')}` : '');
    return { contentText: mergedText.trim(), contentMarkdown: mergedMarkdown.trim() };
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

    const initialPanel = pickActiveDeepResearchPanel();
    const initialSignature = extractDeepResearchPanelSignature(initialPanel);
    const initialHadPanel = !!extractDeepResearchPanelContent(initialPanel);

    const manualDeepResearchJobs = options.manual === true ? buildDeepResearchJobs(blocks) : [];
    const manualDeepResearchResults = options.manual === true && manualDeepResearchJobs.length
      ? await crawlDeepResearchJobsManual(blocks, manualDeepResearchJobs)
      : new Map();
    const manualJobsByBlockIndex = new Map<number, DeepResearchJob[]>();
    for (const job of manualDeepResearchJobs) {
      const existing = manualJobsByBlockIndex.get(job.blockIndex) || [];
      existing.push(job);
      manualJobsByBlockIndex.set(job.blockIndex, existing);
    }

    if (options.manual === true && manualDeepResearchJobs.length) {
      await restoreDeepResearchPanelStateBestEffort({
        blocks,
        jobs: manualDeepResearchJobs,
        initialSignature,
        initialHadPanel,
      });
    }

    const out: any[] = [];
    let seq = 0;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const b = blocks[blockIndex];
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
        const baseText = extractAssistantText(model);
        const baseMarkdown = extractAssistantMarkdown(model, baseText);

        const jobsForBlock = options.manual === true ? (manualJobsByBlockIndex.get(blockIndex) || []) : [];
        const merged = (options.manual === true && jobsForBlock.length)
          ? mergeDeepResearchResults({ baseText, baseMarkdown, jobs: jobsForBlock, results: manualDeepResearchResults })
          : null;

        const deepResearch = merged
          ? null
          : await resolveDeepResearchContent(model, { manual: options.manual === true });

        const text = merged?.contentText || deepResearch?.contentText || baseText;
        const imageScope = (deepResearch?.contentRoot || model) as ParentNode | null;
        const imageUrls = await extractImageUrlsIncludingBlobImages(imageScope, ctx);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMd = merged?.contentMarkdown || deepResearch?.contentMarkdown || baseMarkdown || contentText;
          const contentMarkdown = appendImageMarkdown(baseMd || contentText, imageUrls, { allowDataImageUrls: true });
          out.push({
            // Keep messageKey stable across re-saves by using the base assistant text (without appended reports).
            messageKey: env.normalize.makeFallbackMessageKey({ role: "assistant", contentText: baseText || contentText, sequence: seq }),
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

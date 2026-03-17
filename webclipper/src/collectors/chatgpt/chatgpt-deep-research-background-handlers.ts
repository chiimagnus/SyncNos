import { CHATGPT_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import { scriptingExecuteScript } from '../../platform/webext/scripting';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender?: any) => Promise<any> | any) => void;
};

function toErrorMessage(error: unknown, fallback: string) {
  return (error as any)?.message ?? String(error ?? fallback);
}

function normalizeDeepResearchHost(value: unknown) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  if (host === 'connector_openai_deep_research.web-sandbox.oaiusercontent.com') return host;
  // Allow future aliases under the same oaiusercontent sandbox umbrella.
  if (host.endsWith('.web-sandbox.oaiusercontent.com')) return host;
  return '';
}

export function registerChatgptDeepResearchHandlers(router: AnyRouter) {
  router.register(CHATGPT_MESSAGE_TYPES.EXTRACT_DEEP_RESEARCH, async (msg: any, sender: any) => {
    try {
      const tabId = Number(sender?.tab?.id ?? msg?.tabId);
      if (!Number.isFinite(tabId) || tabId <= 0) return router.err('active tab unavailable');

      const expectedHost = normalizeDeepResearchHost(msg?.expectedHost) || 'connector_openai_deep_research.web-sandbox.oaiusercontent.com';
      const minTextLength = Math.max(80, Number(msg?.minTextLength) || 240);

      const results = await scriptingExecuteScript({
        target: { tabId, allFrames: true },
	        func: ({ expectedHost, minTextLength }: any) => {
	          function normalizeText(value: unknown) {
	            return String(value || '').replace(/\r\n/g, '\n').trim();
	          }

	          function extractTextWithBreaks(node: any): string {
	            if (!node) return '';
	            const TEXT_NODE = typeof Node !== 'undefined' && (Node as any).TEXT_NODE ? (Node as any).TEXT_NODE : 3;
	            const ELEMENT_NODE = typeof Node !== 'undefined' && (Node as any).ELEMENT_NODE ? (Node as any).ELEMENT_NODE : 1;

	            function walk(n: any): string {
	              if (!n) return '';
	              if (n.nodeType === TEXT_NODE) return String(n.nodeValue || '');
	              if (n.nodeType !== ELEMENT_NODE) return '';
	              const tag = String(n.tagName || '').toLowerCase();
	              if (tag === 'br') return '\n';
	              if (tag === 'script' || tag === 'style') return '';
	              const kids = n.childNodes ? Array.from(n.childNodes) : [];
	              return kids.map((c: any) => walk(c)).join('');
	            }

	            return walk(node).replace(/\r\n?/g, '\n');
	          }

	          function pickRoot() {
	            return (
	              document.querySelector('main') ||
	              document.querySelector("[role='main']") ||
              document.querySelector('article') ||
              document.body ||
              document.documentElement
            );
          }

          function pickTitle() {
            const h1 = document.querySelector('h1');
            const title = normalizeText((h1 as any)?.innerText || h1?.textContent || document.title || '');
            return title || 'Deep Research';
          }

          function normalizeMarkdown(markdown: string) {
            const s = String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const lines = s.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));
            return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
          }

          function codeFenceDelimiter(content: string): string {
            const runs = String(content || '').match(/`+/g) || [];
            const longest = runs.reduce((max, s) => Math.max(max, s.length), 0);
            return '`'.repeat(Math.max(3, longest + 1));
          }

          function normalizeCodeLanguage(raw: unknown): string {
            const value = String(raw || '').trim().toLowerCase();
            if (!value) return '';
            if (!/^[a-z0-9_+.-]{1,40}$/.test(value)) return '';
            if (value === 'code' || value === 'text') return '';
            return value;
          }

          function pickCodeLanguageFromClass(className: unknown): string {
            const raw = String(className || '');
            if (!raw) return '';
            const parts = raw.split(/\s+/).filter(Boolean);
            for (const p of parts) {
              const m = p.match(/^(language|lang)-([a-z0-9_+.-]+)$/i);
              if (m && m[2]) {
                const language = normalizeCodeLanguage(m[2]);
                if (language) return language;
              }
            }
            const m2 = raw.match(/\blanguage-([a-z0-9_+.-]+)\b/i);
            if (m2 && m2[1]) return normalizeCodeLanguage(m2[1]);
            return '';
          }

	          function extractPreCodeText(preEl: any): string {
	            if (!preEl) return '';
	            const codeEl = preEl.querySelector ? preEl.querySelector('code') : null;
	            if (codeEl) return String(codeEl.textContent || '').replace(/\r\n?/g, '\n').replace(/\n+$/g, '');

	            const cmContent = preEl.querySelector
	              ? preEl.querySelector('#code-block-viewer .cm-content, #code-block-viewer .cm-line, .cm-content')
	              : null;
	            if (cmContent) {
	              const text = extractTextWithBreaks(cmContent);
	              return String(text || '').replace(/\n+$/g, '');
	            }

	            return String(preEl.textContent || '').replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
	          }

          function detectCodeLanguage(preEl: any): string {
            if (!preEl || !preEl.querySelectorAll) return '';
            const codeEl = preEl.querySelector('code');
            const byCodeClass = pickCodeLanguageFromClass(codeEl && codeEl.getAttribute ? codeEl.getAttribute('class') : '');
            if (byCodeClass) return byCodeClass;

            const nodes: any[] = (Array.from(preEl.querySelectorAll('[data-language],[data-code-language],[class]')) as any[]).slice(0, 16);
            for (const node of nodes) {
              if (!node || !node.getAttribute) continue;
              const langData = normalizeCodeLanguage(node.getAttribute('data-language') || node.getAttribute('data-code-language'));
              if (langData) return langData;
              const byClass = pickCodeLanguageFromClass(node.getAttribute('class') || '');
              if (byClass) return byClass;
            }

            const labels: any[] = (Array.from(preEl.querySelectorAll('span,div')) as any[]).slice(0, 16);
            for (const label of labels) {
              const text = normalizeCodeLanguage(label && label.textContent ? label.textContent : '');
              if (text) return text;
            }
            return '';
          }

	          function looksLikeMermaidSource(text: string): boolean {
	            const s = String(text || '').trim();
	            if (!s || s.length < 12) return false;
	            return /\b(graph\s+(TD|LR|RL|BT)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt)\b/i.test(s);
	          }

		          function extractClipboardCandidates(): string[] {
		            const out: string[] = [];
		            function normalizeBlockText(value: unknown): string {
		              return String(value || '').replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
		            }
		            const selectors = [
		              '[data-clipboard-text]',
		              '[data-copy-text]',
		              '[data-code]',
		              '[data-source]',
		              '[data-raw]',
		              'textarea',
		            ];
		            const nodes: any[] = Array.from(document.querySelectorAll(selectors.join(','))) as any[];
		            for (const node of nodes.slice(0, 120)) {
		              if (!node) continue;
		              const raw =
		                String(node.getAttribute?.('data-clipboard-text') || '') ||
		                String(node.getAttribute?.('data-copy-text') || '') ||
		                String(node.getAttribute?.('data-code') || '') ||
		                String(node.getAttribute?.('data-source') || '') ||
		                String(node.getAttribute?.('data-raw') || '') ||
		                String((node as any).value || node.textContent || '');
		              const text = normalizeBlockText(raw);
		              if (!String(text || '').trim()) continue;
		              if (text.length < 12) continue;
		              if (text.length > 12_000) continue;
		              if (!text.includes('\n') && text.length < 160) continue;
		              out.push(text);
	              if (out.length >= 8) break;
	            }
	            return out;
	          }

	          function extractMermaidSources(): string[] {
	            const sources = new Set<string>();
	            const nodes: any[] = Array.from(document.querySelectorAll('pre,code,div,textarea')) as any[];
	            for (const node of nodes.slice(0, 500)) {
	              if (!node) continue;
	              const cls = String(node.className || '').toLowerCase();
	              const lang = pickCodeLanguageFromClass(node.getAttribute?.('class') || '') || normalizeCodeLanguage(node.getAttribute?.('data-language'));
	              if (lang === 'mermaid' || cls.includes('mermaid')) {
	                const text = normalizeText(node.textContent || '');
	                if (text && text.length >= 12) sources.add(text);
	              }

	              // Some components stash the source in a data attribute.
	              const dataSource = String(node.getAttribute?.('data-mermaid') || node.getAttribute?.('data-mermaid-source') || '').trim();
	              if (dataSource && dataSource.length >= 12) sources.add(dataSource);
	            }

	            for (const candidate of extractClipboardCandidates()) {
	              if (looksLikeMermaidSource(candidate)) sources.add(candidate);
	            }

	            return Array.from(sources).slice(0, 3);
	          }

	          function buildMarkdown(root: any): string {
	            const parts: string[] = [];

            // Primary: extract visible blocks in DOM order.
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
            let node: any = walker.currentNode;
            const visitedPres = new Set<any>();

	            const visitedTextareas = new Set<any>();

	            while (node) {
	              const tag = String(node.tagName || '').toLowerCase();
	              if (tag === 'pre' && !visitedPres.has(node)) {
	                visitedPres.add(node);
	                const code = extractPreCodeText(node);
	                if (code.trim()) {
	                  const lang = detectCodeLanguage(node);
	                  const fence = codeFenceDelimiter(code);
	                  parts.push(`\n\n${fence}${lang}\n${code}\n${fence}\n\n`);
	                }
	              }
	              if (tag === 'textarea' && !visitedTextareas.has(node)) {
	                visitedTextareas.add(node);
	                const value = String((node && typeof (node as any).value === 'string' ? (node as any).value : node.textContent) || '');
	                const code = value.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
	                if (code.trim() && (code.includes('\n') || code.length > 120)) {
	                  const fence = codeFenceDelimiter(code);
	                  const lang = looksLikeMermaidSource(code) ? 'mermaid' : '';
	                  parts.push(`\n\n${fence}${lang}\n${code}\n${fence}\n\n`);
	                }
	              }
	              if (/^h[1-6]$/.test(tag)) {
	                const level = Number(tag.slice(1));
	                const text = normalizeText(node.textContent || '');
	                if (text) parts.push(`${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`);
	              }
              if (tag === 'p') {
                const text = normalizeText(node.textContent || '');
                if (text) parts.push(`${text}\n\n`);
              }
              node = walker.nextNode();
            }

	            // Mermaid: try to recover source even if the diagram itself is rendered as SVG.
	            const mermaids = extractMermaidSources();
	            if (mermaids.length) {
	              for (const src of mermaids) {
	                parts.push(`\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\n`);
	              }
	            }

            return normalizeMarkdown(parts.join(''));
          }

          const host = String(location.hostname || '').trim().toLowerCase();
          if (expectedHost && host !== expectedHost) return null;

          const root = pickRoot() as any;
          const visibleText = normalizeText(root?.innerText || '');
          const domText = normalizeText(root?.textContent || '');
          const text = visibleText.length >= domText.length ? visibleText : domText;
          if (!text || text.length < minTextLength) return null;

          // Some pages render in shadow DOM; `innerHTML/outerHTML` may miss it. Keep HTML best-effort only.
          const html = normalizeText((root as any)?.outerHTML || '');
          const markdown = buildMarkdown(root);

          return {
            href: String(location.href || ''),
            hostname: host,
            title: pickTitle(),
            text,
            html,
            markdown,
          };
        },
        args: [{ expectedHost, minTextLength }],
      });

      const items = (Array.isArray(results) ? results : [])
        .map((r: any) => r?.result)
        .filter(Boolean)
        .filter((x: any) => normalizeDeepResearchHost(x?.hostname));

      return router.ok({ items });
    } catch (e) {
      return router.err(toErrorMessage(e, 'deep research extract failed'));
    }
  });
}

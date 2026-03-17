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

          const host = String(location.hostname || '').trim().toLowerCase();
          if (expectedHost && host !== expectedHost) return null;

          const root = pickRoot() as any;
          const visibleText = normalizeText(root?.innerText || '');
          const domText = normalizeText(root?.textContent || '');
          const text = visibleText.length >= domText.length ? visibleText : domText;
          if (!text || text.length < minTextLength) return null;

          // Some pages render in shadow DOM; `innerHTML/outerHTML` may miss it. Keep HTML best-effort only.
          const html = normalizeText((root as any)?.outerHTML || '');

          return {
            href: String(location.href || ''),
            hostname: host,
            title: pickTitle(),
            text,
            html,
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


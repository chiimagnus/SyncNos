import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture';

function setupDom(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url, pretendToBeVisual: true });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  return dom;
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).location;
  delete (globalThis as any).Node;
  delete (globalThis as any).HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanupDom();
});

describe('current-page-capture chatgpt deep research hydration', () => {
  it('hydrates Deep Research iframe placeholders before saving snapshot', async () => {
    setupDom('https://chatgpt.com/c/conv1');

    const seen: Array<{ type: string; payload?: any }> = [];

    const runtime = {
      send: async (type: string, payload?: any) => {
        seen.push({ type, payload });
        if (type === 'chatgptExtractDeepResearch') {
          const longBody = Array.from({ length: 80 }).map(() => 'Body').join(' ');
          return {
            ok: true,
            data: {
              items: [
                {
                  hostname: 'connector_openai_deep_research.web-sandbox.oaiusercontent.com',
                  href: 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/?app=chatgpt&locale=en-US&deviceType=desktop',
                  title: 'Report',
                  text: `Report\n\n${longBody}`,
                  html: `<div><h1>Report</h1><p>${longBody}</p></div>`,
                },
              ],
            },
          };
        }
        if (type === 'upsertConversation') return { ok: true, data: { id: 101, __isNew: true } };
        if (type === 'syncConversationMessages') {
          const messages = payload?.messages || [];
          expect(messages.some((m: any) => String(m?.contentText || '').includes('Deep Research (iframe):'))).toBe(false);
          expect(messages.some((m: any) => String(m?.contentText || '').includes('Body'))).toBe(true);
          return { ok: true, data: { ok: true } };
        }
        return { ok: true, data: {} };
      },
    };

    const collectorsRegistry = {
      pickActive: () => ({
        id: 'chatgpt',
        collector: {
          capture: () => ({
            conversation: {
              sourceType: 'chat',
              source: 'chatgpt',
              conversationKey: 'conv1',
              title: 'New chat',
              url: 'https://chatgpt.com/c/conv1',
              warningFlags: [],
              lastCapturedAt: Date.now(),
            },
            messages: [
              {
                messageKey: 'm1',
                role: 'assistant',
                contentText:
                  'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
                contentMarkdown:
                  'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
                sequence: 0,
                updatedAt: Date.now(),
              },
            ],
          }),
        },
      }),
      list: () => [],
    };

    const service = createCurrentPageCaptureService({
      runtime: runtime as any,
      collectorsRegistry: collectorsRegistry as any,
    });

    const res = await service.captureCurrentPage();
    expect(res.kind).toBe('chat');
    expect(seen.some((x) => x.type === 'chatgptExtractDeepResearch')).toBe(true);
  });
});

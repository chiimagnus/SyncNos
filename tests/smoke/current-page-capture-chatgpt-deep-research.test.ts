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
          const longBody = Array.from({ length: 80 })
            .map(() => 'Body')
            .join(' ');
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
          expect(messages.some((m: any) => String(m?.contentText || '').includes('Deep Research (iframe):'))).toBe(
            false,
          );
          expect(messages.some((m: any) => String(m?.contentText || '').includes('Body'))).toBe(true);
          expect(payload?.mode).toBe('snapshot');
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
            captureMeta: { completeness: 'complete', identityVerified: true },
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

  it('hydrates multiple Deep Research placeholders without collapsing reports', async () => {
    setupDom('https://chatgpt.com/c/conv-multiple');
    const firstUrl = 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-a?app=chatgpt';
    const secondUrl = 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-b?app=chatgpt';
    const seen: Array<{ type: string; payload?: any }> = [];
    const runtime = {
      send: async (type: string, payload?: any) => {
        seen.push({ type, payload });
        if (type === 'chatgptExtractDeepResearch') {
          expect(payload?.urls).toEqual([firstUrl, secondUrl]);
          return {
            ok: true,
            data: {
              items: [
                {
                  frameId: 10,
                  frameIndex: 0,
                  frameRect: { top: 100, width: 800, height: 500 },
                  href: firstUrl,
                  title: 'First report',
                  text: 'First report body',
                  markdown: '# First report\n\nFirst report body',
                },
                {
                  frameId: 11,
                  frameIndex: 1,
                  frameRect: { top: 700, width: 800, height: 500 },
                  href: secondUrl,
                  title: 'Second report',
                  text: 'Second report body',
                  markdown: '# Second report\n\nSecond report body',
                },
              ],
            },
          };
        }
        if (type === 'upsertConversation') return { ok: true, data: { id: 103, __isNew: false } };
        if (type === 'syncConversationMessages') {
          expect(payload?.mode).toBe('snapshot');
          expect(payload?.messages.map((message: any) => message.contentText)).toEqual([
            'First report body',
            'Second report body',
          ]);
          expect(payload?.messages.map((message: any) => message.contentMarkdown)).toEqual([
            '# First report\n\nFirst report body',
            '# Second report\n\nSecond report body',
          ]);
          return { ok: true, data: { upserted: 2 } };
        }
        return { ok: true, data: {} };
      },
    };
    const service = createCurrentPageCaptureService({
      runtime: runtime as any,
      collectorsRegistry: {
        pickActive: () => ({
          id: 'chatgpt',
          collector: {
            capture: () => ({
              conversation: {
                sourceType: 'chat',
                source: 'chatgpt',
                conversationKey: 'conv-multiple',
                warningFlags: [],
              },
              captureMeta: { completeness: 'complete', identityVerified: true },
              messages: [
                {
                  messageKey: 'report-a',
                  role: 'assistant',
                  contentText: `Deep Research (iframe): ${firstUrl}`,
                  contentMarkdown: `Deep Research (iframe): ${firstUrl}`,
                  sequence: 0,
                },
                {
                  messageKey: 'report-b',
                  role: 'assistant',
                  contentText: `Deep Research (iframe): ${secondUrl}`,
                  contentMarkdown: `Deep Research (iframe): ${secondUrl}`,
                  sequence: 1,
                },
              ],
            }),
          },
        }),
        list: () => [],
      } as any,
    });

    const result = await service.captureCurrentPage();
    expect(result.kind).toBe('chat');
    expect(seen.map((entry) => entry.type)).toEqual([
      'chatgptExtractDeepResearch',
      'upsertConversation',
      'syncConversationMessages',
    ]);
  });

  it('marks unresolved placeholders partial and protective when hydration fails', async () => {
    setupDom('https://chatgpt.com/c/conv2');
    const seen: Array<{ type: string; payload?: any }> = [];
    const placeholder =
      'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt';
    const runtime = {
      send: async (type: string, payload?: any) => {
        seen.push({ type, payload });
        if (type === 'chatgptExtractDeepResearch') return { ok: false, error: { message: 'unavailable' } };
        if (type === 'upsertConversation') {
          expect(payload?.payload?.warningFlags).toContain('deep_research_hydration_incomplete');
          return { ok: true, data: { id: 102, __isNew: false } };
        }
        if (type === 'syncConversationMessages') {
          expect(payload?.mode).toBe('append');
          expect(payload?.messages[0]).toMatchObject({
            contentText: placeholder,
            captureMergePolicy: 'preserve-existing-content',
            captureSequencePolicy: 'preserve-existing-tail',
          });
          return { ok: true, data: { upserted: 1 } };
        }
        return { ok: true, data: {} };
      },
    };
    const service = createCurrentPageCaptureService({
      runtime: runtime as any,
      collectorsRegistry: {
        pickActive: () => ({
          id: 'chatgpt',
          collector: {
            capture: () => ({
              conversation: {
                sourceType: 'chat',
                source: 'chatgpt',
                conversationKey: 'conv2',
                warningFlags: [],
              },
              captureMeta: { completeness: 'complete', identityVerified: true },
              messages: [
                {
                  messageKey: 'm1',
                  role: 'assistant',
                  contentText: placeholder,
                  contentMarkdown: placeholder,
                  sequence: 0,
                },
              ],
            }),
          },
        }),
        list: () => [],
      } as any,
    });

    await service.captureCurrentPage();

    expect(seen.map((entry) => entry.type)).toEqual([
      'chatgptExtractDeepResearch',
      'upsertConversation',
      'syncConversationMessages',
    ]);
  });
});

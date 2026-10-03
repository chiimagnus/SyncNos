import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createNotionAiCollectorDef } from '../../src/collectors/notionai/notionai-collector.ts';
import {
  createNotionAiTranscriptBridge,
  NOTION_AI_TRANSCRIPT_REQUEST,
  NOTION_AI_TRANSCRIPT_RESPONSE,
} from '../../src/collectors/notionai/notionai-transcript.ts';
import { createCollectorsRegistry } from '../../src/collectors/registry.ts';
import normalizeApi from '@services/shared/normalize.ts';

const THREAD_ID = '3ddbe9d6386a80bba61d00a9336cde1e';

function setupDom(url = `https://app.notion.com/chat?t=${THREAD_ID}&wfv=chat`, html = '<div id="notion-app"></div>') {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.location = dom.window.location;
  return dom;
}

function createHarness(dom: JSDOM) {
  const env = createCollectorEnv({
    window: dom.window as any,
    document: dom.window.document as any,
    location: dom.window.location as any,
    normalize: normalizeApi,
  });
  const def = createNotionAiCollectorDef(env) as any;
  const registry = createCollectorsRegistry();
  registry.register(def);
  return { def, collector: def.collector as any, registry };
}

function transcriptState(options: { complete?: boolean; hasFiles?: boolean } = {}) {
  return {
    complete: options.complete ?? true,
    pages: [
      {
        has_more_backward: !(options.complete ?? true),
        patches: [
          {
            op: 'put',
            entity: {
              id: 'user-event',
              kind: 'user_message',
              sequence: 1,
              created_at: '2026-10-03T01:00:00.000Z',
              text: [['用户问题']],
              ...(options.hasFiles ? { has_files: true } : null),
            },
          },
          {
            op: 'put',
            entity: {
              id: 'thinking-event',
              kind: 'thinking',
              sequence: 2,
              content_text: 'private internal reasoning',
            },
          },
          {
            op: 'put',
            entity: {
              id: 'assistant-event',
              kind: 'assistant_message',
              sequence: 3,
              created_at: '2026-10-03T01:00:01.000Z',
              content: [
                {
                  type: 'text',
                  text: '回答 <b>重点</b> <mention url="https://app.notion.com/p/0123456789abcdef0123456789abcdef">页面</mention><edit_reference ids="internal">hidden</edit_reference>',
                },
              ],
            },
          },
          {
            op: 'patch',
            id: 'assistant-event',
            ops: [{ op: 'append', path: '/content/0/text', value: '\n\n后续内容' }],
          },
          {
            op: 'put',
            entity: {
              id: 'tool-event',
              kind: 'tool',
              sequence: 4,
              result: { result_text: 'huge internal tool payload' },
            },
          },
        ],
      },
    ],
  };
}

function prepared(state = transcriptState(), threadId = THREAD_ID) {
  return { __notionAiTranscript: true, threadId, state };
}

describe('notionai-collector', () => {
  it('supports only the current durable /chat?t= Agent Service route', () => {
    const dom = setupDom();
    const { collector, registry } = createHarness(dom);
    const active = registry.pickActive({
      hostname: 'app.notion.com',
      pathname: '/chat',
      href: `https://app.notion.com/chat?t=${THREAD_ID}&wfv=chat`,
    });

    expect(active?.id).toBe('notionai');
    expect(collector.isCaptureAvailable()).toBe(true);
    expect(collector.getRoot()).toBe(dom.window.document.querySelector('#notion-app'));

    const legacyDom = setupDom(
      'https://app.notion.com/chiimagnus/Page-0123456789abcdef0123456789abcdef',
      '<div data-agent-chat-user-step-id="legacy-user"></div>',
    );
    const legacy = createHarness(legacyDom);
    expect(legacy.registry.pickActive(legacyDom.window.location as any)).toBeNull();
    expect(legacy.collector.isCaptureAvailable()).toBe(false);
  });

  it('captures prepared Agent Service transcript and ignores internal execution entities', async () => {
    const dom = setupDom();
    dom.window.document.title = 'New Notion AI | Notion';
    const { collector } = createHarness(dom);

    const snapshot = await collector.capture({
      manual: true,
      preparedCapture: prepared(),
    });

    expect(snapshot.conversation).toEqual(
      expect.objectContaining({
        conversationKey: `notionai_t_${THREAD_ID}`,
        title: 'New Notion AI',
        url: `https://app.notion.com/chat?t=${THREAD_ID}&wfv=chat`,
      }),
    );
    expect(snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user_user-event', role: 'user', contentMarkdown: '用户问题' }),
      expect.objectContaining({
        messageKey: 'assistant_assistant-event',
        role: 'assistant',
        contentMarkdown: '回答 **重点** [页面](https://app.notion.com/p/0123456789abcdef0123456789abcdef)\n\n后续内容',
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private internal reasoning');
    expect(JSON.stringify(snapshot)).not.toContain('huge internal tool payload');
    expect(JSON.stringify(snapshot)).not.toContain('edit_reference');
    expect(snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('requests the full current transcript before manual capture', async () => {
    const dom = setupDom();
    const { collector } = createHarness(dom);
    const state = transcriptState();
    let requestMode = '';

    dom.window.addEventListener('message', (event: MessageEvent) => {
      const data: any = event.data;
      if (!data || data.type !== NOTION_AI_TRANSCRIPT_REQUEST) return;
      requestMode = data.mode;
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          source: dom.window,
          data: {
            __syncnos: true,
            type: NOTION_AI_TRANSCRIPT_RESPONSE,
            requestId: data.requestId,
            threadId: THREAD_ID,
            pages: state.pages,
            complete: state.complete,
          },
        }),
      );
    });

    const preparedCapture = await collector.prepareManualCapture();
    expect(requestMode).toBe('full');
    expect(preparedCapture).toMatchObject({
      __notionAiTranscript: true,
      threadId: THREAD_ID,
      state: { complete: true },
    });

    const snapshot = await collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user_user-event',
      'assistant_assistant-event',
    ]);
  });

  it('requests only the latest transcript window for auto capture', async () => {
    const dom = setupDom();
    const { collector } = createHarness(dom);
    const state = transcriptState({ complete: false });
    let requestMode = '';

    dom.window.addEventListener('message', (event: MessageEvent) => {
      const data: any = event.data;
      if (!data || data.type !== NOTION_AI_TRANSCRIPT_REQUEST) return;
      requestMode = data.mode;
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          source: dom.window,
          data: {
            __syncnos: true,
            type: NOTION_AI_TRANSCRIPT_RESPONSE,
            requestId: data.requestId,
            threadId: THREAD_ID,
            pages: state.pages,
            complete: state.complete,
          },
        }),
      );
    });

    const snapshot = await collector.capture();
    expect(requestMode).toBe('latest');
    expect(snapshot).toMatchObject({
      conversation: { source: 'notionai', conversationKey: `notionai_t_${THREAD_ID}` },
      captureMeta: { completeness: 'partial', identityVerified: true },
    });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user_user-event',
      'assistant_assistant-event',
    ]);
  });

  it('keeps latest auto transcript responses ephemeral instead of growing the full cache', async () => {
    const dom = setupDom();
    const bridge = createNotionAiTranscriptBridge({ window: dom.window as any });
    const full = transcriptState({ complete: true });
    const latest = transcriptState({ complete: false });
    latest.pages[0].patches = latest.pages[0].patches.filter((patch: any) => patch?.entity?.id === 'assistant-event');

    dom.window.addEventListener('message', (event: MessageEvent) => {
      const data: any = event.data;
      if (!data || data.type !== NOTION_AI_TRANSCRIPT_REQUEST) return;
      const state = data.mode === 'full' ? full : latest;
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          source: dom.window,
          data: {
            __syncnos: true,
            type: NOTION_AI_TRANSCRIPT_RESPONSE,
            requestId: data.requestId,
            threadId: THREAD_ID,
            pages: state.pages,
            complete: state.complete,
          },
        }),
      );
    });

    const fullResult = await bridge.requestFull(THREAD_ID);
    const latestResult = await bridge.requestLatest(THREAD_ID);
    expect(fullResult?.pages).toHaveLength(1);
    expect(latestResult?.pages).toHaveLength(1);
    expect(latestResult?.complete).toBe(false);
    expect(bridge.get(THREAD_ID)).toEqual(fullResult);
    expect(bridge.get(THREAD_ID)?.pages).not.toEqual([...full.pages, ...latest.pages]);
  });

  it('fails closed without a matching manual prepared transcript', async () => {
    const dom = setupDom();
    const { collector } = createHarness(dom);

    expect(
      await collector.capture({
        manual: true,
        preparedCapture: prepared(transcriptState(), '0123456789abcdef0123456789abcdef'),
      }),
    ).toBeNull();
    expect(await collector.capture({ manual: true })).toBeNull();
  });

  it('keeps incomplete history and unsupported file metadata partial-safe', async () => {
    const dom = setupDom();
    const { collector } = createHarness(dom);

    const snapshot = await collector.capture({
      manual: true,
      preparedCapture: prepared(transcriptState({ complete: false, hasFiles: true })),
    });

    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toEqual(
      expect.arrayContaining(['notionai_transcript_history_partial', 'notionai_transcript_files_unsupported']),
    );
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user_user-event',
      'assistant_assistant-event',
    ]);
  });
});

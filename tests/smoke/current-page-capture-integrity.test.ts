import { describe, expect, it, vi } from 'vitest';

import { t } from '@i18n';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture';

function chatSnapshot(options?: { completeness?: 'complete' | 'partial'; verified?: boolean; source?: string }) {
  return {
    conversation: {
      sourceType: 'chat',
      source: options?.source || 'chatgpt',
      conversationKey: 'conversation-1',
      title: 'Conversation',
      url: 'https://chatgpt.com/c/conversation-1',
    },
    messages: [{ messageKey: 'm1', role: 'user', contentText: 'hello', sequence: 0 }],
    captureMeta: {
      completeness: options?.completeness || 'complete',
      identityVerified: options?.verified !== false,
    },
  };
}

function createHarness(input: { collectorId: string; snapshot?: any; prepare?: () => any; article?: any }) {
  const calls: Array<{ type: string; payload?: any }> = [];
  const capture = vi.fn((_options?: any) => input.snapshot);
  const runtime = {
    send: vi.fn(async (type: string, payload?: any) => {
      calls.push({ type, payload });
      if (type === 'fetchActiveTabArticle') {
        return { ok: true, data: input.article || { conversationId: 9, title: 'Article', isNew: true } };
      }
      if (type === 'saveConversationSnapshot') return { ok: true, data: { conversationId: 7, isNew: true } };
      return { ok: true, data: {} };
    }),
  };
  const collector: any = { capture };
  if (input.prepare) collector.prepareManualCapture = input.prepare;
  const service = createCurrentPageCaptureService({
    runtime,
    collectorsRegistry: {
      pickActive: () => ({ id: input.collectorId, collector }),
      list: () => [],
    },
  });
  return { service, calls, capture, runtime };
}

describe('current page capture integrity routing', () => {
  it('persists explicit complete capture as snapshot in write order', async () => {
    const harness = createHarness({ collectorId: 'chatgpt', snapshot: chatSnapshot() });

    await harness.service.captureCurrentPage();

    expect(harness.calls.map((call) => call.type)).toEqual(['saveConversationSnapshot']);
    expect(harness.calls[0].payload.snapshot).toMatchObject({ mode: 'snapshot', diff: null });
  });

  it('persists verified partial capture as append with normalized diff', async () => {
    const harness = createHarness({
      collectorId: 'chatgpt',
      snapshot: chatSnapshot({ completeness: 'partial' }),
    });

    const progress: any[] = [];
    const result = await harness.service.captureCurrentPage({ onProgress: (item) => progress.push(item) });

    expect(result).toMatchObject({ captureCompleteness: 'partial' });
    expect(progress.at(-1)?.message).toBe(t('partialCaptureSaved'));
    expect(harness.calls.map((call) => call.type)).toEqual(['saveConversationSnapshot']);
    expect(harness.calls[0].payload.snapshot).toMatchObject({
      mode: 'append',
      diff: { added: ['m1'], updated: [], removed: [] },
    });
    expect(harness.calls[0].payload.snapshot.messages[0]).toMatchObject({
      captureSequencePolicy: 'preserve-existing-tail',
    });
  });

  it.each([
    ['unverified', chatSnapshot({ verified: false })],
    ['missing metadata', { ...chatSnapshot(), captureMeta: undefined }],
    ['unsafe partial', { ...chatSnapshot({ completeness: 'partial' }), messages: [{ contentText: 'no key' }] }],
  ])('sends no write for invalid virtual output: %s', async (_label, snapshot) => {
    const harness = createHarness({ collectorId: 'chatgpt', snapshot });

    await expect(harness.service.captureCurrentPage()).rejects.toThrow();

    expect(harness.calls).toEqual([]);
  });

  it('routes unresolved Deep Research placeholders to protective append', async () => {
    const placeholder = 'Deep Research (iframe): https://example.web-sandbox.oaiusercontent.com/report';
    const harness = createHarness({
      collectorId: 'chatgpt',
      snapshot: {
        ...chatSnapshot(),
        messages: [
          {
            messageKey: 'm1',
            role: 'assistant',
            contentText: placeholder,
            contentMarkdown: placeholder,
            sequence: 0,
          },
        ],
      },
    });

    await harness.service.captureCurrentPage();

    const snapshot = harness.calls.find((call) => call.type === 'saveConversationSnapshot');
    expect(snapshot?.payload.snapshot).toMatchObject({ mode: 'append' });
    expect(snapshot?.payload.snapshot.messages[0]).toMatchObject({
      captureMergePolicy: 'preserve-existing-content',
    });
  });

  it('routes AI Studio image fallback as protective partial append without persisting capture metadata', async () => {
    const snapshot = {
      ...chatSnapshot({ completeness: 'partial', source: 'googleaistudio' }),
      conversation: {
        ...chatSnapshot({ source: 'googleaistudio' }).conversation,
        source: 'googleaistudio',
        url: 'https://aistudio.google.com/app/conversation-1',
      },
      messages: [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'safe body',
          contentMarkdown: 'safe body',
          sequence: 0,
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
      captureMeta: {
        completeness: 'partial',
        identityVerified: true,
        reasons: ['inline_images_incomplete'],
      },
    };
    const harness = createHarness({ collectorId: 'googleaistudio', snapshot });

    await harness.service.captureCurrentPage();

    expect(harness.calls[0].payload.snapshot).not.toHaveProperty('captureMeta');
    expect(harness.calls[0].payload.snapshot).toMatchObject({
      mode: 'append',
      diff: { added: ['m1'], updated: [], removed: [] },
    });
    expect(harness.calls[0].payload.snapshot.messages[0]).toMatchObject({
      captureSequencePolicy: 'preserve-existing-tail',
      captureMergePolicy: 'preserve-existing-markdown',
    });
  });

  it('keeps legacy non-virtual collectors compatible', async () => {
    const snapshot = { ...chatSnapshot({ source: 'gemini' }), captureMeta: undefined };
    const harness = createHarness({ collectorId: 'gemini', snapshot });

    await harness.service.captureCurrentPage();

    expect(harness.calls[0].payload.snapshot).toMatchObject({ mode: 'snapshot', diff: null });
  });

  it.each(['chatgpt', 'googleaistudio'])(
    'passes the exact prepared object to one capture call for %s',
    async (collectorId) => {
      const preparedCapture = { token: Symbol('prepared') };
      const prepare = vi.fn(() => preparedCapture);
      const snapshot = chatSnapshot({ source: collectorId });
      snapshot.conversation.url =
        collectorId === 'chatgpt' ? 'https://chatgpt.com/c/1' : 'https://aistudio.google.com/app/1';
      const harness = createHarness({ collectorId, snapshot, prepare });

      await harness.service.captureCurrentPage();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(harness.capture).toHaveBeenCalledTimes(1);
      expect(harness.capture.mock.calls[0][0]).toEqual({ manual: true, preparedCapture });
      expect(harness.capture.mock.calls[0][0].preparedCapture).toBe(preparedCapture);
    },
  );

  it('stops before capture and persistence when prepare rejects', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('prepare failed');
    });
    const harness = createHarness({ collectorId: 'chatgpt', snapshot: chatSnapshot(), prepare });

    await expect(harness.service.captureCurrentPage()).rejects.toThrow('prepare failed');

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.capture).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([]);
  });

  it('keeps article capture unchanged', async () => {
    const harness = createHarness({ collectorId: 'web', snapshot: null });

    const result = await harness.service.captureCurrentPage();

    expect(result).toMatchObject({ kind: 'article', conversationId: 9, title: 'Article' });
    expect(harness.calls.map((call) => call.type)).toEqual(['fetchActiveTabArticle']);
    expect(harness.capture).not.toHaveBeenCalled();
  });
});

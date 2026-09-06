import { describe, expect, it } from 'vitest';

import {
  VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS,
  resolveCaptureIntegrity,
  type CaptureMessageMergePolicy,
  type CaptureMeta,
} from '@services/shared/capture-integrity';
import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS, SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    conversation: { source: 'chatgpt', conversationKey: 'conversation-1' },
    messages: [{ messageKey: 'm1', role: 'user', contentMarkdown: 'hello', sequence: 0 }],
    captureMeta: { completeness: 'complete', identityVerified: true },
    ...overrides,
  };
}

describe('capture integrity contract', () => {
  it('keeps virtualized providers manual-only from one source', () => {
    expect(Array.from(VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS)).toEqual(['chatgpt', 'googleaistudio']);

    const supportedIds = new Set(SUPPORTED_AI_CHAT_SITES.map((site) => site.id));
    for (const id of VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS) {
      expect(supportedIds.has(id)).toBe(true);
      expect(AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has(id)).toBe(false);
    }

    expect(AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has('gemini')).toBe(true);
  });

  it('keeps capture metadata and merge policies content-free and transient', () => {
    const meta: CaptureMeta = {
      completeness: 'partial',
      identityVerified: true,
      reasons: ['virtual_sweep_incomplete'],
      metrics: { passes: 2, reachedTop: true },
    };
    const mergePolicy: CaptureMessageMergePolicy = 'preserve-existing-markdown';

    expect(meta.metrics).toEqual({ passes: 2, reachedTop: true });
    expect(mergePolicy).toBe('preserve-existing-markdown');
  });
});

describe('resolveCaptureIntegrity', () => {
  it('routes an explicit complete virtual snapshot to snapshot persistence', () => {
    const result = resolveCaptureIntegrity('chatgpt', snapshot());
    expect(result).toMatchObject({ ok: true, persistence: { mode: 'snapshot', diff: null } });
  });

  it.each([
    ['empty messages', []],
    ['missing key', [{ role: 'assistant', contentMarkdown: 'missing' }]],
    ['fallback key', [{ messageKey: 'fallback_1', contentMarkdown: 'fallback' }]],
    [
      'duplicate key',
      [
        { messageKey: 'm1', contentMarkdown: 'first' },
        { messageKey: 'm1', contentMarkdown: 'second' },
      ],
    ],
  ])('never treats complete virtual capture with %s as destructive snapshot', (_label, messages) => {
    const result = resolveCaptureIntegrity('chatgpt', snapshot({ messages }));
    expect(result.ok ? result.persistence.mode : result.code).not.toBe('snapshot');
  });

  it('rejects a virtual snapshot whose source does not match its collector', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({ conversation: { source: 'googleaistudio', conversationKey: 'conversation-1' } }),
    );
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_unverified' });
  });

  it('routes verified partial messages to append with exact transient policy', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({
        captureMeta: {
          completeness: 'partial',
          identityVerified: true,
          reasons: ['timeout', 'timeout'],
          metrics: { passes: 2, ignored: 'content' },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.persistence).toEqual({ mode: 'append', diff: { added: ['m1'], updated: [], removed: [] } });
    expect(result.snapshot.messages[0]).toMatchObject({
      messageKey: 'm1',
      captureSequencePolicy: 'reconcile-existing-order',
    });
    expect(result.snapshot.messages[0]).not.toHaveProperty('captureMergePolicy');
    expect(result.meta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['timeout'],
      metrics: { passes: 2 },
    });
  });

  it.each(['order_unanchored', 'order_conflict'])(
    'keeps virtual partial order conservative when the sweep reports %s',
    (reason) => {
      const result = resolveCaptureIntegrity(
        'chatgpt',
        snapshot({ captureMeta: { completeness: 'partial', identityVerified: true, reasons: [reason] } }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.messages[0]).toMatchObject({
        messageKey: 'm1',
        captureSequencePolicy: 'preserve-existing-tail',
      });
    },
  );

  it.each([
    ['missing metadata', undefined],
    ['invalid metadata', { completeness: 'complete', identityVerified: 'yes' }],
    ['unverified metadata', { completeness: 'partial', identityVerified: false }],
  ])('rejects virtual capture with %s', (_label, captureMeta) => {
    const result = resolveCaptureIntegrity('chatgpt', snapshot({ captureMeta }));
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_unverified' });
  });

  it.each([
    [{ source: '', conversationKey: 'k' }, 'missing source'],
    [{ source: 'chatgpt', conversationKey: '' }, 'missing key'],
  ])('rejects virtual capture with %s', (conversation) => {
    const result = resolveCaptureIntegrity('chatgpt', snapshot({ conversation }));
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_unverified' });
  });

  it.each([
    [{ source: { id: 'chatgpt' }, conversationKey: 'k' }, 'object source'],
    [{ source: 'chatgpt', conversationKey: { id: 'k' } }, 'object conversation key'],
    [{ source: 'chatgpt', conversationKey: 123 }, 'numeric conversation key'],
  ])('rejects non-string virtual identity: %s', (conversation) => {
    const result = resolveCaptureIntegrity('chatgpt', snapshot({ conversation }));
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_unverified' });
  });

  it('rejects non-string partial message keys instead of stringifying them', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({
        captureMeta: { completeness: 'partial', identityVerified: true },
        messages: [
          { messageKey: { id: 'm1' }, contentMarkdown: 'object' },
          { messageKey: 1, contentMarkdown: 'number' },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_no_safe_messages' });
  });

  it('keeps non-virtual collectors on snapshot without metadata', () => {
    const result = resolveCaptureIntegrity('gemini', snapshot({ captureMeta: undefined }));
    expect(result).toMatchObject({ ok: true, meta: null, persistence: { mode: 'snapshot', diff: null } });
  });

  it('deduplicates partial keys with last payload at first key position', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({
        captureMeta: { completeness: 'partial', identityVerified: true },
        messages: [
          { messageKey: 'm1', contentMarkdown: 'first' },
          { messageKey: 'm2', contentMarkdown: 'second' },
          { messageKey: 'm1', contentMarkdown: 'last' },
          { messageKey: '', contentMarkdown: 'empty' },
          { messageKey: 'fallback_123', contentMarkdown: 'fallback' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.messages.map((message: any) => [message.messageKey, message.contentMarkdown])).toEqual([
      ['m1', 'last'],
      ['m2', 'second'],
    ]);
  });

  it('does not let a transient merge policy override complete capture metadata', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({
        messages: [
          {
            messageKey: 'm1',
            contentMarkdown: 'complete body',
            captureMergePolicy: 'preserve-existing-content',
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      meta: { completeness: 'complete' },
      persistence: { mode: 'snapshot', diff: null },
    });
  });

  it('fails partial capture when no safe stable message remains', () => {
    const result = resolveCaptureIntegrity(
      'chatgpt',
      snapshot({
        captureMeta: { completeness: 'partial', identityVerified: true },
        messages: [{ messageKey: 'fallback_bad', contentMarkdown: 'unsafe' }, { contentMarkdown: 'missing' }],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'capture_integrity_no_safe_messages' });
  });
});

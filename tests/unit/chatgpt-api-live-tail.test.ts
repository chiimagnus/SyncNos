import { describe, expect, it } from 'vitest';

import { augmentChatgptApiSnapshotWithLiveTurn } from '@services/integrations/chatgpt/api-live-tail';

const LIVE_TAIL_REASON = 'chatgpt_api_live_tail_unconfirmed';
const LIVE_TAIL_UNRESOLVED_REASON = 'chatgpt_api_live_tail_unresolved';

function snapshot(messages: any[]) {
  return {
    conversation: {
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'conversation-1',
      title: 'Conversation',
      url: 'https://chatgpt.com/c/conversation-1',
    },
    messages,
    captureMeta: { completeness: 'complete' as const, identityVerified: true },
  };
}

function live(userMarkdown: string, assistantMarkdown: string, assistantKey = 'assistant-1') {
  return {
    kind: 'candidate' as const,
    conversationId: 'conversation-1',
    userMessage: { messageKey: 'user-1', role: 'user', contentMarkdown: userMarkdown, sequence: 0, updatedAt: 1 },
    assistantMessage: {
      messageKey: assistantKey,
      role: 'assistant',
      contentMarkdown: assistantMarkdown,
      sequence: 1,
      updatedAt: 2,
    },
  };
}

describe('ChatGPT API live-turn augmentation', () => {
  it('appends the current assistant when the backend branch ends at the current user', () => {
    const api = snapshot([{ messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 }]);
    const result = augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'streaming answer'));

    expect(result.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 }),
      expect.objectContaining({
        messageKey: 'assistant-1',
        role: 'assistant',
        contentMarkdown: 'streaming answer',
        sequence: 1,
      }),
    ]);
    expect(result.captureMeta).toMatchObject({
      completeness: 'partial',
      identityVerified: true,
      reasons: [LIVE_TAIL_REASON],
    });
  });

  it('appends the current user and assistant together when the backend has not materialized either yet', () => {
    const api = snapshot([{ messageKey: 'old-assistant', role: 'assistant', contentMarkdown: 'old', sequence: 0 }]);
    const result = augmentChatgptApiSnapshotWithLiveTurn(api, live('new question', 'new streaming answer'));

    expect(result.messages.map((message: any) => message.messageKey)).toEqual([
      'old-assistant',
      'user-1',
      'assistant-1',
    ]);
    expect(result.captureMeta.reasons).toContain(LIVE_TAIL_REASON);
  });

  it('updates the same assistant key only when the visible content safely extends the backend content', () => {
    const api = snapshot([
      { messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 },
      { messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'hello', sequence: 1 },
    ]);
    const result = augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'hello world'));

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      messageKey: 'assistant-1',
      contentMarkdown: 'hello world',
      sequence: 1,
    });
    expect(result.captureMeta.reasons).toContain(LIVE_TAIL_REASON);
  });

  it('leaves an already matching backend assistant canonical and complete', () => {
    const api = snapshot([
      { messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 },
      { messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'answer', sequence: 1 },
    ]);

    expect(augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'answer'))).toBe(api);
  });

  it('keeps the backend canonical and complete when it is already ahead of the visible DOM', () => {
    const api = snapshot([
      { messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 },
      { messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'hello complete answer', sequence: 1 },
    ]);

    expect(augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'hello'))).toBe(api);
  });

  it('keeps divergent backend content and marks the live tail unresolved instead of guessing', () => {
    const api = snapshot([
      { messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 },
      { messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'backend branch', sequence: 1 },
    ]);
    const result = augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'different visible branch'));

    expect(result.messages[1].contentMarkdown).toBe('backend branch');
    expect(result.captureMeta).toMatchObject({
      completeness: 'partial',
      reasons: [LIVE_TAIL_UNRESOLVED_REASON],
    });
  });

  it('refuses to append a competing assistant after a backend-owned branch', () => {
    const api = snapshot([
      { messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 },
      { messageKey: 'backend-assistant', role: 'assistant', contentMarkdown: 'other branch', sequence: 1 },
    ]);
    const result = augmentChatgptApiSnapshotWithLiveTurn(api, live('question', 'visible branch'));

    expect(result.messages.map((message: any) => message.messageKey)).toEqual(['user-1', 'backend-assistant']);
    expect(result.captureMeta.reasons).toContain(LIVE_TAIL_UNRESOLVED_REASON);
  });

  it('marks unsafe DOM identity partial and rejects conversation identity changes', () => {
    const api = snapshot([{ messageKey: 'user-1', role: 'user', contentMarkdown: 'question', sequence: 0 }]);
    const unsafe = augmentChatgptApiSnapshotWithLiveTurn(api, { kind: 'unsafe' });
    expect(unsafe.captureMeta.reasons).toContain(LIVE_TAIL_UNRESOLVED_REASON);

    expect(() =>
      augmentChatgptApiSnapshotWithLiveTurn(api, {
        ...live('question', 'answer'),
        conversationId: 'conversation-2',
      }),
    ).toThrow('chatgpt_api_navigation_changed');
  });
});

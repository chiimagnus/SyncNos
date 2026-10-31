import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CHAT_INCLUDE_THINKING_STORAGE_KEY,
  applyThinkingCapturePreference,
  composeThinkingMarkdown,
  splitThinkingMarkdown,
} from '@services/shared/thinking-block';

const storage = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/shared/storage', () => ({ storageGet: storage.get }));

beforeEach(() => {
  vi.clearAllMocks();
  storage.get.mockResolvedValue({});
});

describe('AI thinking capture', () => {
  it('keeps reasoning and answer separate in a readable Markdown callout', () => {
    const thinking = '**Plan**\n\nInspect `state`.\n\n```ts\nconst x = 1;\n```';
    const combined = composeThinkingMarkdown(thinking, 'Final **answer**.');
    expect(combined).toBe(
      '> [!NOTE]- Thinking\n>\n> **Plan**\n>\n> Inspect `state`.\n>\n> ```ts\n> const x = 1;\n> ```\n\nFinal **answer**.',
    );
    expect(splitThinkingMarkdown(combined)).toEqual({ thinking, answer: 'Final **answer**.' });
    expect(splitThinkingMarkdown(composeThinkingMarkdown('thought only', ''))).toEqual({
      thinking: 'thought only',
      answer: '',
    });
    expect(composeThinkingMarkdown('', 'Final')).toBe('Final');
  });

  it('does not mistake ordinary assistant Markdown or user messages for thinking', () => {
    expect(splitThinkingMarkdown('Normal answer\n\n> [!NOTE]- Thinking\n> text')).toBeNull();
    expect(splitThinkingMarkdown('> [!NOTE]- Thinking\n> no separator')).toBeNull();
  });

  const snapshot = {
    conversation: { source: 'chatgpt' },
    messages: [
      { messageKey: 'user', role: 'user', contentMarkdown: 'question' },
      { messageKey: 'answer', role: 'assistant', contentMarkdown: composeThinkingMarkdown('reasoning', 'answer') },
      { messageKey: 'thinking', role: 'assistant', contentMarkdown: composeThinkingMarkdown('only thinking', '') },
      { messageKey: 'ordinary', role: 'assistant', contentMarkdown: 'ordinary answer' },
    ],
  };

  it('retains all thinking by default and when explicitly enabled', async () => {
    expect(await applyThinkingCapturePreference(snapshot)).toBe(snapshot);
    storage.get.mockResolvedValue({ [AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]: true });
    expect(await applyThinkingCapturePreference(snapshot)).toBe(snapshot);
    expect(storage.get).toHaveBeenCalledWith([AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]);
  });

  it('omits thinking in new captures when disabled, without modifying the original snapshot', async () => {
    storage.get.mockResolvedValue({ [AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]: false });
    const result = await applyThinkingCapturePreference(snapshot);
    expect(result.messages).toEqual([
      snapshot.messages[0],
      { ...snapshot.messages[1], contentMarkdown: 'answer' },
      snapshot.messages[3],
    ]);
    expect(snapshot.messages).toHaveLength(4);
    expect(snapshot.messages[1].contentMarkdown).toContain('reasoning');
  });

  it('never strips user-authored Markdown that resembles a thinking block', async () => {
    storage.get.mockResolvedValue({ [AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]: false });
    const quoted = composeThinkingMarkdown('User quote', 'User wrote this');
    const result = await applyThinkingCapturePreference({
      messages: [
        { role: 'user', contentMarkdown: quoted },
        { role: 'assistant', contentMarkdown: composeThinkingMarkdown('Private thought', 'Answer') },
      ],
    });
    expect(result.messages[0].contentMarkdown).toBe(quoted);
    expect(result.messages[1].contentMarkdown).toBe('Answer');
  });

  it('does not read storage when there are no recognizable thinking blocks', async () => {
    const result = await applyThinkingCapturePreference({ messages: [{ contentMarkdown: 'ordinary answer' }] });
    expect(result.messages).toHaveLength(1);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('fails the save rather than silently persisting thinking when the preference cannot be read', async () => {
    storage.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(applyThinkingCapturePreference(snapshot)).rejects.toThrow('storage unavailable');
  });
});

import { storageGet } from '@services/shared/storage';
import { splitThinkingMarkdown } from '@services/shared/thinking-markdown';

export { composeThinkingMarkdown, splitThinkingMarkdown } from '@services/shared/thinking-markdown';

export const AI_CHAT_INCLUDE_THINKING_STORAGE_KEY = 'ai_chat_include_thinking_v1';

export async function applyThinkingCapturePreference(snapshot: any): Promise<any> {
  if (!Array.isArray(snapshot?.messages)) return snapshot;
  if (
    !snapshot.messages.some(
      (message: any) => message?.role === 'assistant' && splitThinkingMarkdown(String(message?.contentMarkdown || '')),
    )
  ) {
    return snapshot;
  }
  const local = await storageGet([AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]);
  if (local?.[AI_CHAT_INCLUDE_THINKING_STORAGE_KEY] !== false) return snapshot;
  return {
    ...snapshot,
    messages: snapshot.messages.flatMap((message: any) => {
      if (message?.role !== 'assistant') return [message];
      const thinking = splitThinkingMarkdown(String(message?.contentMarkdown || ''));
      if (!thinking) return [message];
      return thinking.answer ? [{ ...message, contentMarkdown: thinking.answer }] : [];
    }),
  };
}

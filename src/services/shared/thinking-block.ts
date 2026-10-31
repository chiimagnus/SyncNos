import { storageGet } from '@services/shared/storage';

export const AI_CHAT_INCLUDE_THINKING_STORAGE_KEY = 'ai_chat_include_thinking_v1';

const THINKING_HEADER = '> [!NOTE]- Thinking';

export function composeThinkingMarkdown(thinking: string, answer: string): string {
  const body = thinking.trim();
  if (!body) return answer;
  const quoted = body.split('\n').map((line) => (line ? `> ${line}` : '>'));
  return [THINKING_HEADER, '>', ...quoted, ...(answer ? ['', answer] : [])].join('\n');
}

export function splitThinkingMarkdown(markdown: string): { thinking: string; answer: string } | null {
  if (!markdown.startsWith(THINKING_HEADER)) return null;
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== THINKING_HEADER || lines[1] !== '>') return null;
  const thinkingLines: string[] = [];
  let index = 2;
  while (index < lines.length && /^>(?: |$)/.test(lines[index])) {
    thinkingLines.push(lines[index].replace(/^> ?/, ''));
    index += 1;
  }
  if (!thinkingLines.length || (index < lines.length && lines[index] !== '')) return null;
  return {
    thinking: thinkingLines.join('\n'),
    answer: index < lines.length ? lines.slice(index + 1).join('\n') : '',
  };
}

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

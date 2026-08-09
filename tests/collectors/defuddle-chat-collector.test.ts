import { JSDOM } from 'jsdom';
import Defuddle from 'defuddle';
import { describe, expect, it, vi } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createDefuddleChatCollectorDefs } from '../../src/collectors/defuddle-chat/defuddle-chat-collector.ts';

function capture(id: string, html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  const env = createCollectorEnv({
    window: dom.window as any,
    document: dom.window.document as any,
    location: dom.window.location as any,
    normalize: normalizeApi,
  });
  const definition = createDefuddleChatCollectorDefs(env).find((item) => item.id === id);
  if (!definition) throw new Error(`missing Defuddle collector: ${id}`);
  const preparedCapture = definition.collector.prepareManualCapture?.({ manual: true });
  return definition.collector.capture({ manual: true, preparedCapture }) as any;
}

describe('defuddle-chat-collector', () => {
  it('uses Defuddle ChatGPT conversation extraction without async fallback', () => {
    const parseAsync = vi.spyOn(Defuddle.prototype, 'parseAsync');
    const snapshot = capture(
      'chatgpt',
      `
        <main>
          <section data-testid="conversation-turn-1">
            <h4 class="sr-only">You said:</h4>
            <div data-message-author-role="user"><div class="whitespace-pre-wrap">Plan a picnic</div></div>
          </section>
          <section data-testid="conversation-turn-2">
            <h4 class="sr-only">ChatGPT said:</h4>
            <div data-message-author-role="assistant"><div class="markdown"><h2>Checklist</h2><p>Bring water.</p></div></div>
          </section>
        </main>
      `,
      'https://chatgpt.com/c/picnic',
    );

    expect(snapshot?.conversation).toMatchObject({ source: 'chatgpt', conversationKey: 'c_picnic' });
    expect(snapshot?.captureMeta).toMatchObject({ completeness: 'partial', identityVerified: true });
    expect(snapshot?.messages).toMatchObject([
      { role: 'user', contentText: 'Plan a picnic' },
      { role: 'assistant', contentText: 'Checklist Bring water.' },
    ]);
    expect(snapshot.messages[1].contentMarkdown).toContain('## Checklist');
    expect(snapshot.messages.every((message: any) => message.messageKey.startsWith('defuddle_'))).toBe(true);
    expect(parseAsync).not.toHaveBeenCalled();
  });

  it.each([
    [
      'claude',
      'https://claude.ai/chat/abc',
      `
        <div data-testid="user-message"><p>Summarize this.</p></div>
        <div class="font-claude-response"><div class="standard-markdown"><p>Here is the summary.</p></div></div>
      `,
    ],
    [
      'gemini',
      'https://gemini.google.com/app/abc',
      `
        <div class="conversation-container">
          <user-query><div class="query-text">Explain this.</div></user-query>
          <model-response><div class="model-response-text"><div class="markdown"><p>Here is an explanation.</p></div></div></model-response>
        </div>
      `,
    ],
    [
      'grok',
      'https://grok.com/chat/abc',
      `
        <div class="relative group flex flex-col justify-center w-full items-end"><div class="message-bubble">Find news.</div></div>
        <div class="relative group flex flex-col justify-center w-full items-start"><div class="message-bubble"><p>Here is the answer.</p></div></div>
      `,
    ],
  ])('uses Defuddle %s conversation extraction', (id, url, html) => {
    const snapshot = capture(id, html, url);

    expect(snapshot?.conversation).toMatchObject({ source: id });
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
    expect(snapshot.messages.map((message: any) => message.contentText).join('\n')).not.toContain('undefined');
  });
});

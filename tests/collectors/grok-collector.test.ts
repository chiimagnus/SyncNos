import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '@collectors/collector-env.ts';
import { createGrokCollectorDef } from '@collectors/grok/grok-collector.ts';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';

const CONVERSATION_ID = '12345678-1234-4234-8234-123456789abc';
const URL = 'https://grok.com/c/' + CONVERSATION_ID;

function uuid(index: number): string {
  return '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
}

function row(
  index: number,
  role: 'user' | 'assistant',
  markdown: string,
  options: { marker?: string; messageId?: string; media?: string } = {},
): string {
  const id = uuid(index);
  const marker = options.marker ?? id;
  const messageId = options.messageId ?? id;
  return [
    '<div data-plane-row="gateway:' + marker + '">',
    '<div id="response-' + messageId + '">',
    '<div data-testid="' + role + '-message" role="article" class="message-bubble">',
    '<div class="thinking-container"><p>Private reasoning should not appear.</p></div>',
    '<div class="response-content-markdown markdown">' + markdown + '</div>',
    '<section class="inline-media-container">' + (options.media || '') + '</section>',
    '<div class="action-buttons"><button>Copy response</button><img src="https://example.com/icon.png"></div>',
    '</div></div></div>',
  ].join('');
}

function setup(rows: string, options: { url?: string; busy?: boolean; sidebarTitle?: string } = {}) {
  const url = options.url || URL;
  const title = options.sidebarTitle ?? 'Saved Grok title';
  const dom = new JSDOM(
    '<body><nav><a data-sidebar="menu-button" href="/c/' +
      CONVERSATION_ID +
      '">' +
      title +
      '</a>' +
      '<a href="/c/other">Sidebar text must not be captured</a></nav>' +
      '<main><div data-testid="chat-transcript-scroller" style="overflow-y:auto" aria-busy="' +
      (options.busy ? 'true' : 'false') +
      '">' +
      rows +
      '</div></main></body>',
    { url },
  );
  dom.window.scrollTo = vi.fn();
  const def = createGrokCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  );
  return { dom, def };
}

async function capture(def: ReturnType<typeof createGrokCollectorDef>, options: Record<string, unknown> = {}) {
  const prepared = await def.collector.prepareManualCapture?.({
    manual: true,
    stableSamples: 1,
    pollMs: 0,
    sleep: async () => {},
    ...options,
  });
  return (await def.collector.capture({ manual: true, preparedCapture: prepared })) as any;
}

describe('Grok plane transcript collector', () => {
  it('recognizes /c/<UUID> and rejects home, settings, other hosts and share routes', () => {
    expect(setup('').def.id).toBe('grok');
    expect(setup('').def.matches({ hostname: 'grok.com' })).toBe(true);
    expect(setup('').def.matches({ hostname: 'fakegrok.com' })).toBe(false);
    for (const path of [
      '/',
      '/settings',
      '/c/',
      '/c/unknown',
      '/share/public-id',
      '/c/' + CONVERSATION_ID + '/details',
    ]) {
      expect(setup('', { url: 'https://grok.com' + path }).def.collector.isCaptureAvailable()).toBe(false);
    }
    expect(setup('', { url: URL + '?from=history' }).def.collector.isCaptureAvailable()).toBe(true);
    expect(setup('', { url: URL + '/' }).def.collector.isCaptureAvailable()).toBe(true);
  });

  it('captures real response IDs, roles and title without sidebar or thinking text', async () => {
    const fixture =
      row(1, 'user', '<p>What is <strong>Grok</strong>?</p>') + row(2, 'assistant', '<p>A <em>chatbot</em>.</p>');
    const snapshot = await capture(setup(fixture).def);
    expect(snapshot.conversation).toMatchObject({
      sourceType: 'chat',
      source: 'grok',
      conversationKey: CONVERSATION_ID,
      title: 'Saved Grok title',
      url: URL,
    });
    expect(snapshot.messages.map((m: any) => [m.messageKey, m.role])).toEqual([
      ['response-' + uuid(1), 'user'],
      ['response-' + uuid(2), 'assistant'],
    ]);
    expect(snapshot.messages[0].contentMarkdown).toBe('What is **Grok**?');
    expect(snapshot.messages[1].contentMarkdown).toBe('A *chatbot*.');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Private reasoning');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Copy response');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('icon.png');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Sidebar');
    expect(snapshot.captureMeta).toMatchObject({ completeness: 'partial', identityVerified: true });
    expect(snapshot.captureMeta.reasons).toContain('top_not_reached');
    const persistence = resolveCaptureIntegrity('grok', snapshot);
    expect(persistence.ok).toBe(true);
    if (persistence.ok) expect(persistence.persistence.mode).toBe('append');
  });

  it('preserves code blocks, nested lists, links and tables in Markdown', async () => {
    const assistant = [
      '<h2>Header</h2><ul><li>one<ul><li>two</li></ul></li></ul>',
      '<p><a href="https://example.com/reference">Reference</a></p>',
      '<pre><code class="language-ts">const value = 2;\nconsole.log(value);</code></pre>',
      '<table><tr><th>Value</th><th>Number</th></tr><tr><td>A</td><td>2</td></tr></table>',
    ].join('');
    const snapshot = await capture(setup(row(1, 'user', '<p>Markdown test</p>') + row(2, 'assistant', assistant)).def);
    expect(snapshot.messages[1].contentMarkdown).toContain('## Header');
    expect(snapshot.messages[1].contentMarkdown).toContain('- one');
    expect(snapshot.messages[1].contentMarkdown).toContain('[Reference](https://example.com/reference)');
    expect(snapshot.messages[1].contentMarkdown).toContain('const value = 2;');
    expect(snapshot.messages[1].contentMarkdown).toContain('| A | 2 |');
  });

  it('extracts Shiki language while discarding the header and copy controls', async () => {
    const shiki =
      '<div data-testid="code-block" class="chat-code-block">' +
      '<div class="rounded-t-xl"><span class="font-mono">TypeScript</span><button>Copy</button></div>' +
      '<div class="shiki"><pre class="shiki"><code><span class="line">const value = 42;</span></code></pre></div></div>';
    const snapshot = await capture(setup(row(1, 'user', '<p>Code</p>') + row(2, 'assistant', shiki)).def);
    expect(snapshot.messages[1].contentMarkdown).toContain('typescript\nconst value = 42;');
    expect(snapshot.messages[1].contentMarkdown).not.toMatch(/(^|\n)TypeScript\s*($|\n)/);
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Copy');
  });

  it('saves inline-media images but excludes action-bar icons and duplicates', async () => {
    const fixture =
      row(1, 'user', '<p>Picture</p>', {
        media: '<img src="https://images.example.com/upload.jpg">',
      }) + row(2, 'assistant', '<p><img src="https://images.example.com/generated.png"></p>');
    const snapshot = await capture(setup(fixture).def);
    expect(snapshot.messages[0].contentMarkdown).toContain('![](https://images.example.com/upload.jpg)');
    expect(snapshot.messages[1].contentMarkdown).toContain('![](https://images.example.com/generated.png)');
    expect(snapshot.messages[1].contentMarkdown.match(/generated\.png/g)).toHaveLength(1);
    expect(snapshot.messages[1].contentMarkdown).not.toContain('icon.png');
  });

  it('keeps stable IDs on repeated capture after DOM wrapper changes', async () => {
    const fixture = row(1, 'user', '<p>Same text</p>') + row(2, 'assistant', '<p>Same reply</p>');
    const first = await capture(setup(fixture).def);
    const second = await capture(
      setup(fixture.replace('class="message-bubble"', 'class="message-bubble refreshed"')).def,
    );
    expect(second.messages.map((m: any) => m.messageKey)).toEqual(first.messages.map((m: any) => m.messageKey));
    expect(second.conversation.conversationKey).toBe(first.conversation.conversationKey);
  });

  it('preserves earlier user messages while assistant is still generating', async () => {
    const fixture = row(1, 'user', '<p>Prompt</p>') + row(2, 'assistant', '<p>Partial answer</p>');
    const snapshot = await capture(setup(fixture, { busy: true }).def);
    expect(snapshot.messages.map((m: any) => m.role)).toEqual(['user']);
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toContain('unresolved_turn');
  });

  it('keeps durable response IDs when the live gateway marker differs before a reload', async () => {
    const live = row(1, 'user', '<p>Stable</p>') + row(2, 'assistant', '<p>New reply</p>', { marker: uuid(3) });
    const settled = row(1, 'user', '<p>Stable</p>') + row(2, 'assistant', '<p>New reply</p>');
    const first = await capture(setup(live).def);
    const second = await capture(setup(settled).def);
    expect(first.messages.map((m: any) => m.messageKey)).toEqual(second.messages.map((m: any) => m.messageKey));
    expect(first.messages).toHaveLength(2);
    expect(first.messages[1].contentMarkdown).toBe('New reply');
  });

  it('does not invent a message ID when the response UUID is malformed', async () => {
    const fixture =
      row(1, 'user', '<p>Stable</p>') + row(2, 'assistant', '<p>Untrusted</p>', { messageId: 'not-a-uuid' });
    const snapshot = await capture(setup(fixture).def);
    expect(snapshot.messages.map((m: any) => m.messageKey)).toEqual(['response-' + uuid(1)]);
    expect(snapshot.captureMeta.reasons).toContain('unstable_identity');
  });

  it('refuses empty pages and unsupported routes rather than saving sidebars', async () => {
    expect(await capture(setup('').def)).toBeNull();
    expect(await capture(setup(row(1, 'user', '<p>Content</p>'), { url: 'https://grok.com/' }).def)).toBeNull();
  });

  it('rejects prepared snapshots after navigation to another conversation', async () => {
    const { def, dom } = setup(row(1, 'user', '<p>Prompt</p>') + row(2, 'assistant', '<p>Reply</p>'));
    const prepared = await def.collector.prepareManualCapture?.({
      manual: true,
      stableSamples: 1,
      pollMs: 0,
      sleep: async () => {},
    });
    dom.window.history.replaceState({}, '', '/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await def.collector.capture({ manual: true, preparedCapture: prepared })).toBeNull();
  });

  it('saves 12 rounds in order without duplicate messages', async () => {
    const rows = Array.from(
      { length: 12 },
      (_, index) =>
        row(index * 2 + 1, 'user', '<p>Question ' + index + '</p>') +
        row(index * 2 + 2, 'assistant', '<p>Answer ' + index + '</p>'),
    ).join('');
    const snapshot = await capture(setup(rows).def);
    expect(snapshot.messages).toHaveLength(24);
    expect(snapshot.messages.map((m: any) => m.messageKey)).toEqual(
      Array.from({ length: 24 }, (_, index) => 'response-' + uuid(index + 1)),
    );
    expect(snapshot.messages.at(-1).contentMarkdown).toBe('Answer 11');
    expect(snapshot.messages.every((m: any, i: number) => m.sequence === i)).toBe(true);
  });

  it('sweeps virtualized overlapping windows and restores the original scroll position', async () => {
    const all = Array.from(
      { length: 12 },
      (_, index) =>
        row(index * 2 + 1, 'user', '<p>Question ' + index + '</p>') +
        row(index * 2 + 2, 'assistant', '<p>Answer ' + index + '</p>'),
    );
    const { dom, def } = setup(all.slice(8, 12).join(''));
    const scroller = dom.window.document.querySelector('[data-testid="chat-transcript-scroller"]') as HTMLElement;
    let scrollTop = 700;
    const render = () => {
      const start = scrollTop < 200 ? 0 : scrollTop < 470 ? 4 : 8;
      scroller.innerHTML = all.slice(start, start + 6).join('');
    };
    Object.defineProperties(scroller, {
      scrollTop: {
        get: () => scrollTop,
        set: (next: number) => {
          scrollTop = next;
          render();
        },
        configurable: true,
      },
      scrollHeight: { value: 900, configurable: true },
      clientHeight: { value: 200, configurable: true },
    });
    render();

    const snapshot = await capture(def, { maxSteps: 24, totalDeadlineMs: 3000 });
    expect(snapshot.messages).toHaveLength(24);
    expect(snapshot.messages.map((m: any) => m.messageKey)).toEqual(
      Array.from({ length: 24 }, (_, index) => 'response-' + uuid(index + 1)),
    );
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.metrics.reachedTop).toBe(true);
    expect(snapshot.captureMeta.metrics.reachedBottom).toBe(true);
    expect(scrollTop).toBe(700);
  });

  it('falls back to first user text when active sidebar title is unavailable', async () => {
    const fixture = row(1, 'user', '<p>One test conversation</p>') + row(2, 'assistant', '<p>Answer</p>');
    const { dom, def } = setup(fixture);
    dom.window.document.querySelector('a[data-sidebar]')?.remove();
    const snapshot = await capture(def);
    expect(snapshot.conversation.title).toBe('One test conversation');
  });
});

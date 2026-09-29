import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { createClaudeCollectorDef } from '@collectors/claude/claude-collector.ts';
import { createCollectorEnv } from '@collectors/collector-env.ts';
import normalizeApi from '@services/shared/normalize.ts';

function setupClaudeDom(input?: { streaming?: boolean; title?: string }) {
  const streaming = input?.streaming === true;
  const html = [
    '<!doctype html>',
    '<html>',
    '<head><title>' + (input?.title || 'Stable Claude Capture - Claude') + '</title></head>',
    '<body>',
    '<main>',
    '<div role="feed" data-perf-region="transcript" aria-label="Chat messages">',
    '<div data-testid="transcript-row" data-rs-index="0" data-index="0" data-perf-row="human" data-perf-row-streaming="false">',
    '<div role="article" aria-posinset="1" aria-setsize="2" aria-label="Message 1 of 2">',
    '<div data-testid="user-message"><p>Hello <strong>Claude</strong></p></div>',
    '<img src="https://img.test/user.png" />',
    '<div data-cds="MessageAttachments">',
    '<div data-testid="file-thumbnail" data-cds="MessageAttachmentsQuote">',
    '<span class="sr-only" aria-describedby="_r_quote_">Preview file</span>',
    '<blockquote id="_r_quote_">Quoted attachment context</blockquote>',
    '</div>',
    '<div data-testid="file-thumbnail" data-cds="MessageAttachmentsFile">',
    '<span class="sr-only">Open file</span>',
    '<div>notes.pdf</div>',
    '<div>PDF</div>',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '<div data-testid="transcript-row" data-rs-index="1" data-index="1" data-perf-row="assistant" data-perf-row-streaming="' +
      String(streaming) +
      '">',
    '<div role="article" aria-posinset="2" aria-setsize="2" aria-label="Message 2 of 2">',
    '<div data-testid="assistant-message" data-is-streaming="' + String(streaming) + '">',
    '<div class="font-claude-response">',
    '<div class="standard-markdown" data-perf-reply-text><p>I will inspect the page first.</p></div>',
    '<div data-testid="TurnStatus" data-cds="TurnStatus"><span>Used Notion integration</span></div>',
    '<div class="standard-markdown" data-perf-reply-text>',
    '<h2>Final answer</h2>',
    '<p>This is the captured response.</p>',
    '<pre><code class="language-ts">const value = 1;</code></pre>',
    '<img src="https://img.test/assistant.png" />',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');

  const dom = new JSDOM(html, { url: 'https://claude.ai/chat/conv-1' });
  (dom.window as any).scrollTo = () => {};
  const env = createCollectorEnv({
    window: dom.window as any,
    document: dom.window.document as any,
    location: dom.window.location as any,
    normalize: normalizeApi,
  });
  return { dom, def: createClaudeCollectorDef(env) as any };
}

async function prepareStaticCapture(def: any) {
  return def.collector.prepareManualCapture({
    totalDeadlineMs: 1_000,
    maxSteps: 4,
    stableSamples: 1,
    pollMs: 0,
    stepTimeoutMs: 100,
    boundaryTimeoutMs: 100,
  });
}

describe('claude-collector', () => {
  it('keeps a valid Claude chat route ready before transcript rows render', () => {
    const empty = new JSDOM('<body><main></main></body>', { url: 'https://claude.ai/chat/conv-empty' });
    const emptyEnv = createCollectorEnv({
      window: empty.window as any,
      document: empty.window.document as any,
      location: empty.window.location as any,
      normalize: normalizeApi,
    });
    expect(createClaudeCollectorDef(emptyEnv).collector.getCaptureReadiness()).toBe('ready');

    const settings = new JSDOM('<body></body>', { url: 'https://claude.ai/settings' });
    const settingsEnv = createCollectorEnv({
      window: settings.window as any,
      document: settings.window.document as any,
      location: settings.window.location as any,
      normalize: normalizeApi,
    });
    expect(createClaudeCollectorDef(settingsEnv).collector.getCaptureReadiness()).toBe('unsupported');
  });

  it('captures all visible assistant prose while excluding separate status nodes', async () => {
    const { def } = setupClaudeDom();
    const snapshot = await def.collector.capture({
      manual: true,
      preparedCapture: await prepareStaticCapture(def),
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.conversation).toMatchObject({
      sourceType: 'chat',
      source: 'claude',
      conversationKey: 'chat_conv-1',
      title: 'Stable Claude Capture',
    });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'claude:1:user',
      'claude:2:assistant',
    ]);
    expect(snapshot.messages.map((message: any) => message.sequence)).toEqual([0, 1]);

    const user = snapshot.messages[0];
    expect(user.contentText).toContain('Quoted attachment context');
    expect(user.contentText).toContain('notes.pdf');
    expect(user.contentText).not.toContain('Preview file');
    expect(user.contentText).not.toContain('Open file');
    expect(user.contentMarkdown).toContain('**Claude**');
    expect(user.contentMarkdown).toContain('> Quoted attachment context');
    expect(user.contentMarkdown).toContain('notes.pdf');
    expect(user.contentMarkdown).not.toContain('> notes.pdf');
    expect(user.contentMarkdown.indexOf('> Quoted attachment context')).toBeLessThan(
      user.contentMarkdown.indexOf('Hello'),
    );
    expect(user.contentMarkdown).toContain('![](https://img.test/user.png)');

    const assistant = snapshot.messages[1];
    expect(assistant.contentText).toContain('I will inspect the page first.');
    expect(assistant.contentText).toContain('Final answer');
    expect(assistant.contentText).not.toContain('Used Notion integration');
    expect(assistant.contentMarkdown).toContain('I will inspect the page first.');
    expect(assistant.contentMarkdown).toContain('## Final answer');
    expect(assistant.contentMarkdown).toContain('const value = 1;');
    expect(assistant.contentMarkdown).toContain('![](https://img.test/assistant.png)');
  });

  it('uses aria message positions as stable identity and confirms complete visible boundaries', () => {
    const { def } = setupClaudeDom();
    const descriptors = def.collector.__test.readCurrentDescriptors();

    expect(descriptors.map((descriptor: any) => [descriptor.key, descriptor.position, descriptor.total])).toEqual([
      ['claude:1:user', 1, 2],
      ['claude:2:assistant', 2, 2],
    ]);
    expect(def.collector.__test.readBoundaryState('top')).toBe('confirmed');
    expect(def.collector.__test.readBoundaryState('bottom')).toBe('confirmed');
  });

  it('treats a streaming assistant row as unresolved instead of persisting an in-flight reply', () => {
    const { def } = setupClaudeDom({ streaming: true });
    const assistant = def.collector.__test.readCurrentDescriptors().find((item: any) => item.role === 'assistant');

    expect(assistant).toMatchObject({
      key: 'claude:2:assistant',
      streaming: true,
      rendered: false,
    });
  });

  it('prepares a complete static transcript and restores the manual capture contract', async () => {
    const { def } = setupClaudeDom();
    const prepared = await prepareStaticCapture(def);

    expect(prepared).toMatchObject({
      source: 'claude',
      conversationKey: 'chat_conv-1',
      identityVerified: true,
      completeness: 'complete',
    });
    expect(prepared.records.map((record: any) => record.key)).toEqual(['claude:1:user', 'claude:2:assistant']);
  });

  it('captures attachment-only user rows without requiring a text content node', async () => {
    const { dom, def } = setupClaudeDom();
    dom.window.document.querySelector("[data-testid='user-message']")?.remove();

    const snapshot = await def.collector.capture({
      manual: true,
      preparedCapture: await prepareStaticCapture(def),
    });
    const user = snapshot.messages.find((message: any) => message.role === 'user');

    expect(user.contentText).toContain('Quoted attachment context');
    expect(user.contentText).toContain('notes.pdf');
    expect(user.contentMarkdown).toContain('![](https://img.test/user.png)');
  });

  it('keeps semantic fingerprints stable when transient attachment DOM ids change', () => {
    const { dom, def } = setupClaudeDom();
    const before = def.collector.__test.readCurrentDescriptors().find((item: any) => item.role === 'user').fingerprint;
    const quote = dom.window.document.querySelector("[data-cds='MessageAttachmentsQuote']");
    quote?.querySelector('blockquote')?.setAttribute('id', '_r_quote_changed_');
    quote?.querySelector('[aria-describedby]')?.setAttribute('aria-describedby', '_r_quote_changed_');
    const after = def.collector.__test.readCurrentDescriptors().find((item: any) => item.role === 'user').fingerprint;

    expect(after).toBe(before);
  });

  it('is manual-only and rejects prepared data after navigating to another Claude conversation', async () => {
    const { dom, def } = setupClaudeDom();
    expect(await def.collector.capture()).toBeNull();

    const prepared = await prepareStaticCapture(def);
    dom.window.history.pushState({}, '', '/chat/conv-2');

    expect(await def.collector.capture({ manual: true, preparedCapture: prepared })).toBeNull();
  });
});

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildChatgptGeneratedImageMessageKey } from '@services/shared/chatgpt-image-identity';
import { markdownToSemanticText } from '@services/shared/markdown-semantic-text';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createChatgptCollectorDef } from '../../src/collectors/chatgpt/chatgpt-collector.ts';
import chatgptMarkdown from '../../src/collectors/chatgpt/chatgpt-markdown.ts';

function setupChatgptDom(html: string, url: string) {
  return new JSDOM(`<body><main>${html}</main></body>`, { url });
}

function semanticText(message: any): string {
  return markdownToSemanticText(message?.contentMarkdown, { includeImageAlt: true }).trim();
}

function currentDom(
  options: {
    url?: string;
    turnKey?: string;
    ordinal?: number;
    userId?: string;
    assistantId?: string;
    assistantIds?: string;
    userText?: string;
    assistantContent?: string;
    expandedCot?: boolean;
    cotContent?: string;
    beforeTurn?: string;
  } = {},
) {
  const turnKey = options.turnKey ?? 'user-message-1';
  const ordinal = options.ordinal ?? 0;
  const userId = options.userId ?? 'user-message-1';
  const assistantId = options.assistantId ?? 'assistant-message-1';
  const assistantIds = options.assistantIds ?? `${assistantId} ${assistantId}`;
  const userText = options.userText ?? 'Current question';
  const expandedCot = options.expandedCot ?? false;
  const cotContent =
    options.cotContent ??
    '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Reasoning <strong>step</strong>.</p></div>';
  const cot = `
    <div class="block-current-cot">
      <span hidden data-chatgpt-agent-turn-start></span>
      <div>
        <div class="group/activity-header">
          <button type="button" aria-expanded="${expandedCot ? 'true' : 'false'}"></button>
          <span>Thought for 1s</span>
        </div>
        ${expandedCot ? `<div class="current-cot-body">${cotContent}</div>` : ''}
      </div>
    </div>
  `;
  const assistantContent =
    options.assistantContent ??
    `<div data-chatgpt-selection-conversation-id="conversation-1" data-chatgpt-selection-message-id="${assistantId}">
      <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <p>Final <strong>answer</strong>.</p>
        <div data-markdown-copy="code-block">
          <div data-markdown-copy="exclude">typescript<button type="button">Copy</button></div>
          <div><code class="language-ts">const value = 1;</code></div>
        </div>
      </div>
    </div>`;

  const dom = setupChatgptDom(
    `
      ${options.beforeTurn ?? ''}
      <div data-turn-key="${turnKey}">
        <div data-content-search-turn-key="fallback-turn-${ordinal}">
          <div
            data-chatgpt-search-unit-key="fallback-turn-${ordinal}:0:user"
            data-chatgpt-search-message-ids="${userId}"
            data-is-intersecting="true"
          >
            <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${userText}</div></div>
          </div>
          <div
            data-chatgpt-search-unit-key="fallback-turn-${ordinal}:2:assistant"
            data-chatgpt-search-message-ids="${assistantIds}"
            data-is-intersecting="true"
          >
            ${cot}
            ${assistantContent}
          </div>
        </div>
      </div>
    `,
    options.url ?? 'https://chatgpt.com/c/conversation-1',
  );
  (dom.window as any).scrollTo = vi.fn();
  return dom;
}

function currentDef(dom: JSDOM) {
  return createChatgptCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  ) as any;
}

async function prepare(def: any, options: any = {}) {
  return def.collector.prepareManualCapture({
    stableSamples: 1,
    pollMs: 0,
    sleep: async () => {},
    ...options,
  });
}

async function capturePrepared(def: any, options: any = {}) {
  const preparedCapture = await prepare(def, options);
  return preparedCapture ? def.collector.capture({ manual: true, preparedCapture }) : null;
}

describe('chatgpt current DOM', () => {
  it('matches only the canonical ChatGPT hostname and waits without current message units', () => {
    const canonical = currentDef(currentDom());
    expect(canonical.matches({ hostname: 'chatgpt.com' })).toBe(true);
    expect(canonical.matches({ hostname: 'www.chatgpt.com' })).toBe(false);
    expect(canonical.matches({ hostname: 'chat.openai.com' })).toBe(false);

    const empty = currentDef(setupChatgptDom('', 'https://chatgpt.com/'));
    expect(empty.collector.getCaptureReadiness()).toBe('waiting');
  });

  it('captures current user/assistant units, expanded reasoning, and current code blocks', async () => {
    const dom = currentDom({
      expandedCot: true,
      cotContent: `
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
          <p>Reasoning <strong>step</strong>.</p>
        </div>
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">
          <p>Visible tool summary</p>
        </div>
      `,
    });
    const def = currentDef(dom);
    expect(def.collector.getCaptureReadiness()).toBe('ready');

    const snapshot = (await capturePrepared(def)) as any;
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user-message-1',
      'assistant-message-1',
    ]);
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', contentMarkdown: 'Current question' });
    expect(snapshot.messages[1].contentMarkdown).toContain('Reasoning **step**.');
    expect(snapshot.messages[1].contentMarkdown).toContain('Visible tool summary');
    expect(snapshot.messages[1].contentMarkdown).toContain('Final **answer**.');
    expect(snapshot.messages[1].contentMarkdown).toContain('```ts\nconst value = 1;\n```');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Copy');
  });

  it('keeps collapsed reasoning out and captures it when expanded after prepare', async () => {
    const dom = currentDom({ expandedCot: false });
    const def = currentDef(dom);
    const preparedCapture = await prepare(def);
    const before = preparedCapture.records.find((record: any) => record.key === 'assistant-message-1');
    expect(before.payload.contentMarkdown).not.toContain('Reasoning step.');

    const button = dom.window.document.querySelector('button[aria-expanded]') as HTMLButtonElement;
    button.setAttribute('aria-expanded', 'true');
    const body = dom.window.document.createElement('div');
    body.className = 'current-cot-body';
    body.innerHTML =
      '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Reasoning after prepare.</p></div>';
    button.parentElement?.insertAdjacentElement('afterend', body);

    const snapshot = await def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages[1].contentMarkdown).toContain('Reasoning after prepare.');
    expect(snapshot.captureMeta).toMatchObject({ completeness: 'partial' });
    expect(snapshot.captureMeta.reasons).toContain('final_live_changed');
  });

  it('captures rich current assistant Markdown while removing source chrome and non-content icons', async () => {
    const dom = currentDom({
      assistantContent: `
        <div data-chatgpt-selection-conversation-id="conversation-1" data-chatgpt-selection-message-id="assistant-message-1">
          <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
            <h2>Heading</h2>
            <blockquote><p>Quote</p></blockquote>
            <ul><li>Item</li></ul>
            <p><strong>bold</strong> <em>italic</em> <a href="https://example.com">link</a></p>
            <p><a href="https://arxiv.org/abs/2312.10997"><img src="https://t0.gstatic.com/faviconV2?url=https%3A%2F%2Farxiv.org" />arXiv</a></p>
            <img src="https://chatgpt.com/images/ecosystem/apps/github/icon.png" />
            <img src="https://example.com/chart.png" />
          </div>
        </div>
      `,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('## Heading');
    expect(markdown).toContain('> Quote');
    expect(markdown).toContain('- Item');
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('*italic*');
    expect(markdown).toContain('[link](https://example.com)');
    expect(markdown).toContain('[arXiv](https://arxiv.org/abs/2312.10997)');
    expect(markdown).toContain('![](https://example.com/chart.png)');
    expect(markdown).not.toContain('gstatic.com/faviconV2');
    expect(markdown).not.toContain('chatgpt.com/images/ecosystem/apps/github/icon.png');
  });

  it('preserves hidden rendered code sources such as Mermaid', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div id="root">
        <p>Diagram</p>
        <div class="mermaid">
          <svg aria-hidden="true"><path d="M0 0"></path></svg>
          <pre class="sr-only" aria-hidden="true"><code class="language-mermaid">graph TD
A --> B</code></pre>
        </div>
      </div>
    </body>`);
    const root = dom.window.document.querySelector('#root');
    const markdown = chatgptMarkdown.extractRenderedMarkdown(root);
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('graph TD');
    expect(markdown).toContain('A --> B');
  });

  it('uses protected generated-image identity instead of transient message ids', async () => {
    const fileId = 'file_shared_generated_1';
    const imageUrl = `https://chatgpt.com/backend-api/estuary/content?id=${fileId}&ts=1&sig=temporary`;
    const expectedKey = buildChatgptGeneratedImageMessageKey([fileId]);
    const dom = currentDom({
      assistantId: 'transient-assistant-id',
      assistantContent: `
        <div data-chatgpt-selection-message-id="transient-assistant-id">
          <div data-markdown-text-style="assistant-message"><img src="${imageUrl}" alt="generated cube" /></div>
        </div>
      `,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.messages[1].messageKey).toBe(expectedKey);
    expect(expectedKey).not.toContain(fileId);
  });

  it('keeps Deep Research as a stable placeholder for later hydration', async () => {
    const reportUrl = 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-a';
    const dom = currentDom({
      assistantContent: `<iframe title="internal://deep-research" src="${reportUrl}"></iframe>`,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.messages[1]).toMatchObject({
      messageKey: 'assistant-message-1',
      role: 'assistant',
      contentMarkdown: `Deep Research (iframe): ${reportUrl}`,
    });
  });

  it('uses active Project conversation title, otherwise derives a generic durable title from the first user message', async () => {
    const project = currentDom({
      url: 'https://chatgpt.com/g/p_1/c/conv_project_1',
      beforeTurn:
        '<h1>Research</h1><nav><a href="/g/p_1/c/conv_project_1" aria-current="page"><span>GPR signal preprocessing</span></a></nav>',
    });
    project.window.document.title = 'ChatGPT';
    expect((await capturePrepared(currentDef(project))).conversation.title).toBe('GPR signal preprocessing');

    const generic = currentDom({
      url: 'https://chatgpt.com/c/conversation-title-1',
      userText: '请帮我分析强化学习和机器学习的关系',
    });
    generic.window.document.title = 'ChatGPT';
    expect((await capturePrepared(currentDef(generic))).conversation.title).toBe('请帮我分析强化学习和机器学习的关系');
  });

  it('captures current share pages and uses the share id as durable identity', async () => {
    const dom = currentDom({ url: 'https://chatgpt.com/share/share-current-1' });
    dom.window.document.title = 'Shared current conversation';
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.conversation).toMatchObject({
      conversationKey: 'share-current-1',
      title: 'Shared current conversation',
    });
  });

  it('binds temporary-chat identity only to rendered current units and keeps it stable across prompt edits', async () => {
    const first = currentDom({
      url: 'https://chatgpt.com/?temporary-chat=true',
      turnKey: 'stable-temp-turn',
      userId: 'stable-temp-user',
      assistantId: 'stable-temp-assistant',
      assistantIds: 'stable-temp-assistant',
      userText: 'first draft',
    });
    first.window.document.title = 'ChatGPT';
    const firstSnapshot = (await capturePrepared(currentDef(first))) as any;
    expect(firstSnapshot.conversation.conversationKey).toMatch(/^chatgpt_/);
    expect(firstSnapshot.conversation.title).toBe('first draft');

    const edited = currentDom({
      url: 'https://chatgpt.com/?temporary-chat=true',
      turnKey: 'stable-temp-turn',
      userId: 'stable-temp-user',
      assistantId: 'stable-temp-assistant',
      assistantIds: 'stable-temp-assistant',
      userText: 'edited prompt',
    });
    edited.window.document.title = 'ChatGPT';
    const editedSnapshot = (await capturePrepared(currentDef(edited))) as any;
    expect(editedSnapshot.conversation.conversationKey).toBe(firstSnapshot.conversation.conversationKey);

    const emptyShell = setupChatgptDom(
      '<div data-turn-key="empty-turn"><div data-content-search-turn-key="fallback-turn-0"></div></div>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    const guard = currentDef(emptyShell).collector.__test.sampleIdentityGuard(
      emptyShell.window.document.querySelector('main'),
    );
    expect(guard.anchors).toEqual([]);
  });

  it('rejects a prepared temporary capture after same-path identity replacement', async () => {
    const first = currentDef(
      currentDom({
        url: 'https://chatgpt.com/?temporary-chat=true',
        turnKey: 'temp-a',
        userId: 'user-a',
        assistantId: 'assistant-a',
        assistantIds: 'assistant-a',
      }),
    );
    const preparedCapture = await prepare(first);

    const second = currentDef(
      currentDom({
        url: 'https://chatgpt.com/?temporary-chat=true',
        turnKey: 'temp-b',
        userId: 'user-b',
        assistantId: 'assistant-b',
        assistantIds: 'assistant-b',
      }),
    );
    expect(await second.collector.capture({ manual: true, preparedCapture })).toBeNull();
  });

  it('provides only stable current DOM ids to Advanced API live-tail and fails closed otherwise', () => {
    const def = currentDef(currentDom());
    const live = def.collector.captureApiLiveTurn({ expectedConversationId: 'conversation-1' });
    expect(live).toMatchObject({
      kind: 'candidate',
      conversationId: 'conversation-1',
      userMessage: { messageKey: 'user-message-1', role: 'user', contentMarkdown: 'Current question' },
      assistantMessage: { messageKey: 'assistant-message-1', role: 'assistant' },
    });
    expect(semanticText(live.assistantMessage)).toContain('Final answer.');

    const missingAssistantId = currentDef(currentDom({ assistantIds: '' }));
    expect(missingAssistantId.collector.captureApiLiveTurn({ expectedConversationId: 'conversation-1' })).toEqual({
      kind: 'unsafe',
    });
    expect(def.collector.captureApiLiveTurn({ expectedConversationId: 'other-conversation' })).toEqual({
      kind: 'identity_changed',
    });
  });

  it('uses current fallback-turn ordinals and the dedicated history-loading sentinel for top completeness', () => {
    const dom = currentDom();
    const turn = dom.window.document.querySelector('[data-content-search-turn-key]') as HTMLElement;
    const adapter = currentDef(dom).collector.__test.manualAdapter;

    turn.setAttribute('data-content-search-turn-key', 'fallback-turn-10');
    expect(adapter.readBoundaryState('top')).toBe('pending');
    turn.setAttribute('data-content-search-turn-key', 'fallback-turn-0');
    expect(adapter.readBoundaryState('top')).toBe('confirmed');

    const unrelated = dom.window.document.createElement('div');
    unrelated.setAttribute('role', 'progressbar');
    dom.window.document.querySelector('main')?.prepend(unrelated);
    expect(adapter.readBoundaryState('top')).toBe('confirmed');

    const boundary = dom.window.document.createElement('div');
    boundary.setAttribute('data-chatgpt-conversation-selection-target', 'true');
    boundary.innerHTML = '<div role="status">Loading earlier messages</div>';
    dom.window.document.querySelector('main')?.prepend(boundary);
    expect(adapter.readBoundaryState('top')).toBe('pending');
  });

  it('uses the current inner timeline scroller as the manual sweep seed', () => {
    const dom = currentDom();
    const main = dom.window.document.querySelector('main') as HTMLElement;
    const scroller = dom.window.document.createElement('div');
    scroller.setAttribute('data-app-action-timeline-scroll', '');
    while (main.firstChild) scroller.appendChild(main.firstChild);
    main.appendChild(scroller);
    expect(currentDef(dom).collector.__test.manualAdapter.readScrollSeed()).toBe(scroller);
  });
});

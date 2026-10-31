import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatDetailView } from '@ui/conversations/views/ChatDetailView';
import { composeThinkingMarkdown } from '@services/shared/thinking-block';

function renderConversation(source: string, markdown: string, role = 'assistant') {
  return renderToStaticMarkup(
    createElement(ChatDetailView, {
      selected: { id: 2178, source },
      activeId: 2178,
      detail: { conversationId: 2178, messages: [{ id: 24933, role, contentMarkdown: markdown }] },
      outlineIndexByMessageId: new Map<number, number>(),
      getUserMessageRefSetter: () => () => {},
      setMessagesRootRef: () => {},
    }),
  );
}

describe('ChatDetailView ChatGPT rich content', () => {
  it('preserves the structured thinking disclosure through rich-content normalization', () => {
    const markdown = composeThinkingMarkdown('**Planning**\n\nInspect code', 'Final answer');
    const html = renderConversation('chatgpt', markdown);
    expect(html).toContain('<details');
    expect(html).toContain('Thinking</summary>');
    expect(html).not.toContain('<strong>Planning</strong>');
    expect(html).toContain('Final answer');
    expect(html).not.toContain('[!NOTE]- Thinking');
  });
  it('renders old ChatGPT layout markup as Markdown without changing stored data', () => {
    const saved = [
      '## 方法',
      '',
      '      **第 1 步：建立模型**',
      '',
      '      | 参数 | 数值 |',
      '      | --- | --- |',
      '      | 半径 | 25 mm |',
      '',
      '  <divider color="subtle"/>',
      '',
      '参考 <Cite ref="turn0search1"/>',
    ].join('\n');
    const html = renderConversation('chatgpt', saved);

    expect(html).toContain('<strong>第 1 步：建立模型</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<hr>');
    expect(html).not.toContain('<pre>');
    expect(html).not.toContain('&lt;divider');
    expect(html).toContain('引用见原对话');
    expect(saved).toContain('<divider');
  });

  it('does not alter ChatGPT user messages containing literal markup', () => {
    const html = renderConversation('chatgpt', '<row>literal markup</row>', 'user');
    expect(html).toContain('&lt;row&gt;literal markup&lt;/row&gt;');
  });

  it('keeps literal rich markup intact for other providers', () => {
    const saved = '<row>literal article example</row>';
    const html = renderConversation('claude', saved);
    expect(html).toContain('&lt;row&gt;literal article example&lt;/row&gt;');
  });
});

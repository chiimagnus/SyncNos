import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';

import { normalizeDilMarkdown } from '@services/shared/dil-markdown';

const parser = new MarkdownIt({ html: false });

describe('normalizeDilMarkdown', () => {
  it('converts a ChatGPT rich layout into readable Markdown without treating the content as code', () => {
    const raw = [
      '## 方法',
      '<row align="start" gap={3}>',
      '  <box background="secondary">',
      '    <icon name="shapes"/>',
      '  </box>',
      '  <box flex="1">',
      '      **第 1 步：建立模型**',
      '',
      '      | 参数 | 数值 |',
      '      | --- | --- |',
      '      | 半径 | 25 mm |',
      '',
      '      文字中有公式 \\(K\\)。',
      '  </box>',
      '</row>',
      '<divider color="subtle"/>',
      '资料：<Link url="https://example.com/method" title="论文"/> <Cite ref="turn0search1"/>',
    ].join('\n');
    const markdown = normalizeDilMarkdown(raw);
    const tokens = parser.parse(markdown, {});

    expect(markdown).toContain('**第 1 步：建立模型**');
    expect(markdown).toContain('| 参数 | 数值 |');
    expect(markdown).toContain('[论文](<https://example.com/method>)');
    expect(markdown).toContain('（引用见原对话）');
    expect(markdown).not.toMatch(/<(?:row|box|icon|divider|Cite|Link)\b/);
    expect(tokens.some((token) => token.type === 'code_block')).toBe(false);
    expect(tokens.some((token) => token.type === 'table_open')).toBe(true);
    expect(tokens.some((token) => token.type === 'hr')).toBe(true);
  });

  it('repairs already captured rich text without requiring recapture', () => {
    const stored = [
      '## 步骤',
      '',
      '      **第 1 步：建立模型**',
      '',
      '      | 参数 | 数值 |',
      '      | --- | --- |',
      '      | 半径 | 25 mm |',
      '',
      '      这些内容不是代码。',
      '',
      '  <divider color="subtle"/>',
      '',
      '      **第 2 步：计算**',
      '',
      '      正文里的 \\[a+b\\] 应当显示为公式。',
    ].join('\n');
    const markdown = normalizeDilMarkdown(stored);
    const tokens = parser.parse(markdown, {});

    expect(tokens.some((token) => token.type === 'code_block')).toBe(false);
    expect(tokens.some((token) => token.type === 'table_open')).toBe(true);
    expect(tokens.some((token) => token.type === 'hr')).toBe(true);
    expect(markdown).toContain('**第 2 步：计算**');
  });

  it('restores flattened flow nodes around rich arrow separators', () => {
    const source = [
      '<divider color="subtle"/>',
      '',
      '    **读取应力场**',
      '    读取裂尖附近的数值',
      '',
      '  ↓',
      '',
      '    **判断失效模式**',
      '    根据数值判断方向',
    ].join('\n');
    const markdown = normalizeDilMarkdown(source);
    expect(parser.parse(markdown, {}).some((token) => token.type === 'code_block')).toBe(false);
    expect(markdown).toContain('**读取应力场**\n读取裂尖附近的数值');
    expect(markdown).toContain('**判断失效模式**\n根据数值判断方向');
  });

  it('does not modify genuine code blocks or ordinary Markdown without rich markup', () => {
    const plain = ['    **This is literal code**', '', '| a | b |', '| - | - |'].join('\n');
    expect(normalizeDilMarkdown(plain)).toBe(plain);
    const withRich = [
      '<divider color="subtle"/>',
      '',
      '    **Literal code stays indented four spaces**',
      '',
      '```md',
      '<row>literal markup inside code fence</row>',
      '<Cite ref="literal"/>',
      '```',
    ].join('\n');
    const markdown = normalizeDilMarkdown(withRich);
    expect(markdown).toContain('    **Literal code stays indented four spaces**');
    expect(markdown).toContain('<row>literal markup inside code fence</row>');
    expect(markdown).toContain('<Cite ref="literal"/>');
  });

  it('keeps genuine code fences inside ChatGPT layout containers', () => {
    const source = ['<box>', '      ```python', '      print(1 + 1)', '      ```', '</box>'].join('\n');
    const normalized = normalizeDilMarkdown(source);
    expect(normalized).toContain('```python\nprint(1 + 1)\n```');
    expect(parser.parse(normalized, {}).some((token) => token.type === 'fence')).toBe(true);
  });

  it('does not end a longer fenced code block on a shorter fence inside it', () => {
    const source = [
      '<divider color="subtle"/>',
      '',
      '````md',
      '<box>literal</box>',
      '```',
      '<Cite ref="inside-code"/>',
      '````',
    ].join('\n');
    const markdown = normalizeDilMarkdown(source);
    expect(markdown).toContain('<box>literal</box>');
    expect(markdown).toContain('<Cite ref="inside-code"/>');
    expect(parser.parse(markdown, {}).filter((token) => token.type === 'fence')).toHaveLength(1);
  });

  it('preserves fenced code contents and blank lines even when they contain DIL examples', () => {
    const codeOnly = ['~~~html', '<box>literal</box>', '', '', '', 'end', '~~~', ''].join('\n');
    expect(normalizeDilMarkdown(codeOnly)).toBe(codeOnly);

    const mixed = ['<divider color="subtle"/>', '', '~~~html', '<box>literal</box>', '', '', '', 'end', '~~~'].join(
      '\n',
    );
    expect(normalizeDilMarkdown(mixed)).toContain('~~~html\n<box>literal</box>\n\n\n\nend\n~~~');
  });

  it('keeps inline code and unsafe links literal instead of running rich markup', () => {
    const source = [
      '代码示例 `<Cite ref="literal"/>` 和正常引用 <Cite ref="real"/>。',
      '<Link url="javascript:alert(1)" title="unsafe"/>',
    ].join('\n');
    const markdown = normalizeDilMarkdown(source);
    expect(markdown).toContain('`<Cite ref="literal"/>`');
    expect(markdown).toContain('（引用见原对话）');
    expect(markdown).not.toContain('](javascript:');
  });
});

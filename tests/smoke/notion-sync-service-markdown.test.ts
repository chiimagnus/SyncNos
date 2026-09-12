import { describe, expect, it } from 'vitest';
import { markdownToNotionBlocks } from '@services/sync/notion/notion-markdown-blocks';
import { messagesToBlocks } from '@services/sync/notion/notion-sync-service';

describe('notion sync markdown', () => {
  it('parses inline markdown into rich_text', () => {
    const blocks = markdownToNotionBlocks('Hello **bold** and `code` plus [link](https://example.com).');
    const rich = blocks[0]?.paragraph?.rich_text || [];

    const bold = rich.find((x: any) => x?.type === 'text' && x?.annotations?.bold);
    expect(bold?.text?.content).toBe('bold');
    const code = rich.find((x: any) => x?.type === 'text' && x?.annotations?.code);
    expect(code?.text?.content).toBe('code');
    const link = rich.find((x: any) => x?.type === 'text' && x?.text?.link);
    expect(link?.text?.link?.url).toBe('https://example.com');
  });

  it('converts markdown to notion blocks (basic types)', () => {
    const md = [
      '### Title',
      '',
      '- item **b**',
      '1. num *i*',
      '',
      '> quoted line',
      '',
      '---',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
    ].join('\n');

    const blocks = markdownToNotionBlocks(md);
    expect(blocks.some((b: any) => b?.type === 'heading_3')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'bulleted_list_item')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'numbered_list_item')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'quote')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'divider')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'code')).toBe(true);
    expect(blocks.some((b: any) => b?.type === 'equation')).toBe(true);

    const bullet = blocks.find((b: any) => b?.type === 'bulleted_list_item');
    const rich = bullet?.bulleted_list_item?.rich_text || [];
    expect(rich.find((x: any) => x?.type === 'text' && x?.annotations?.bold)?.text?.content).toBe('b');
  });

  it('downgrades oversized inline equations into chunkable literal code text', () => {
    const longExpression = 'x'.repeat(2118);
    const blocks = markdownToNotionBlocks(`Before $${longExpression}$ after`);
    const rich = blocks
      .filter((b: any) => b?.type === 'paragraph')
      .flatMap((block: any) => block?.paragraph?.rich_text || []);

    expect(rich.some((item: any) => item?.type === 'equation')).toBe(false);
    expect(
      rich
        .filter((item: any) => item?.type === 'text' && item?.annotations?.code)
        .map((item: any) => item?.text?.content || '')
        .join(''),
    ).toContain(`$${longExpression}$`);
  });

  it('downgrades oversized block equations into plain-text code blocks', () => {
    const longExpression = 'y'.repeat(2118);
    const blocks = markdownToNotionBlocks(['$$', longExpression, '$$'].join('\n'));

    expect(blocks.some((b: any) => b?.type === 'equation')).toBe(false);
    const literal = blocks
      .filter((b: any) => b?.type === 'code')
      .flatMap((block: any) => block?.code?.rich_text || [])
      .map((item: any) => item?.text?.content || '')
      .join('');
    expect(literal).toContain('$$');
    expect(literal).toContain(longExpression);
  });

  it('converts image markdown to notion image blocks', () => {
    const blocks = markdownToNotionBlocks(['Hello', '', '![](https://example.com/a.png)', '', 'World'].join('\n'));
    const image = blocks.find((b: any) => b?.type === 'image');
    expect(image?.image?.type).toBe('external');
    expect(image?.image?.external?.url).toBe('https://example.com/a.png');
  });

  it('converts data:image markdown to notion image blocks (upgradeable)', () => {
    const blocks = markdownToNotionBlocks(
      ['Hello', '', '![](data:image/png;base64,iVBORw0KGgo=)', '', 'World'].join('\n'),
    );
    const image = blocks.find((b: any) => b?.type === 'image');
    expect(image?.image?.type).toBe('external');
    expect(String(image?.image?.external?.url || '')).toContain('data:image/png;base64,');
  });

  it('messagesToBlocks uses markdown when present', () => {
    const blocks = messagesToBlocks([{ role: 'assistant', contentMarkdown: '- item **b**' }]);
    expect(blocks.some((b: any) => b?.type === 'bulleted_list_item')).toBe(true);
  });

  it('messagesToBlocks uses message.authorName for user role', () => {
    const blocks = messagesToBlocks([{ role: 'user', authorName: 'Alice', contentMarkdown: 'hi' }]);
    const heading = blocks.find((b: any) => b?.type === 'heading_3');
    expect(heading?.heading_3?.rich_text?.[0]?.text?.content).toBe('Alice');
  });

  it('converts fenced code through messagesToBlocks', () => {
    const blocks = messagesToBlocks([{ role: 'assistant', contentMarkdown: '```js\nconsole.log(1)\n```' }]);
    expect(blocks.some((b: any) => b?.type === 'code')).toBe(true);
  });

  it('splits oversized rich_text arrays into multiple notion blocks', () => {
    const markdown = Array.from({ length: 140 }, (_, index) => `**bold-${index}**`).join(' ');
    const paragraphs = markdownToNotionBlocks(markdown).filter((block: any) => block?.type === 'paragraph');

    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((block: any) => (block?.paragraph?.rich_text || []).length <= 100)).toBe(true);
  });

  it('handles long timestamp transcripts without recursive stack growth', () => {
    const markdown = Array.from(
      { length: 8000 },
      (_, index) =>
        `[00:${String(index % 60).padStart(2, '0')}.000 → 00:${String((index + 1) % 60).padStart(2, '0')}.000] cue ${index}`,
    ).join('\n');

    const paragraphs = markdownToNotionBlocks(markdown).filter((block: any) => block?.type === 'paragraph');
    const rendered = paragraphs
      .flatMap((block: any) => block?.paragraph?.rich_text || [])
      .map((item: any) => item?.text?.content || '')
      .join('');

    expect(paragraphs.length).toBeGreaterThan(1);
    expect(rendered).toBe(markdown);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownIt from 'markdown-it';

import { captureCurrentChatgptConversationViaApi } from '@services/integrations/chatgpt/api-capture';
import { buildChatgptApiSnapshot } from '@services/integrations/chatgpt/api-snapshot';
import { buildChatgptGeneratedImageMessageKey } from '@services/shared/chatgpt-image-identity';
import {
  CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY,
  readChatgptApiCaptureEnabled,
  writeChatgptApiCaptureEnabled,
} from '@services/integrations/chatgpt/api-capture-settings';

const storageMocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
}));

type MessageInput = {
  id: string;
  role: string;
  parent?: string | null;
  recipient?: string;
  channel?: string;
  contentType?: string;
  parts?: any[];
  content?: string;
  thoughts?: any[];
  turnId?: string;
  hidden?: boolean;
  attachments?: any[];
  contentReferences?: any[];
  imageTitle?: string;
  authorName?: string;
  status?: string;
};

function message(input: MessageInput) {
  return {
    id: input.id,
    author: { role: input.role, ...(input.authorName ? { name: input.authorName } : null) },
    recipient: input.recipient ?? 'all',
    ...(input.channel ? { channel: input.channel } : null),
    content: {
      content_type: input.contentType || 'text',
      ...(input.parts ? { parts: input.parts } : null),
      ...(input.content != null ? { content: input.content } : null),
      ...(input.thoughts ? { thoughts: input.thoughts } : null),
    },
    ...(input.status ? { status: input.status } : null),
    metadata: {
      ...(input.turnId ? { turn_id: input.turnId } : null),
      ...(input.hidden ? { is_visually_hidden_from_conversation: true } : null),
      ...(input.attachments ? { attachments: input.attachments } : null),
      ...(input.contentReferences ? { content_references: input.contentReferences } : null),
      ...(input.imageTitle ? { image_gen_title: input.imageTitle } : null),
    },
  };
}

function pagedFrom(messages: Array<ReturnType<typeof message>>, currentIndex = messages.length - 1) {
  return {
    conversation_id: 'conversation-1',
    title: 'API Conversation',
    messages: messages.slice(0, currentIndex + 1),
    current_node: messages[currentIndex]?.id,
  };
}

function build(data: any) {
  return buildChatgptApiSnapshot({
    data,
    conversationId: 'conversation-1',
    conversationUrl: 'https://chatgpt.com/c/conversation-1',
    capturedAt: 123,
  });
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as any)?.code || (error as any)?.message || '');
  }
  return '';
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.get.mockResolvedValue({});
  storageMocks.set.mockResolvedValue(undefined);
});

describe('ChatGPT API snapshot', () => {
  it('ignores widget reference metadata when its marker does not occur in rendered text', () => {
    const widget = 'genui' + JSON.stringify({ charts_widget_v2: { content: { data: [1, 2] } } }) + '';
    const chart =
      '<Chart content={{"chartType":"line","xKey":"x","series":[{"dataKey":"y"}],"data":[{"x":"2026","y":38}]}}/>';
    const snapshot = build(
      pagedFrom([
        message({ id: 'user', role: 'user', parts: ['q'] }),
        message({
          id: 'assistant',
          role: 'assistant',
          channel: 'final',
          parts: [chart],
          contentReferences: [{ type: 'client_defined_widget', matched_text: widget }],
        }),
      ]),
    ).snapshot;
    expect(snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
    expect(snapshot.messages[1].contentMarkdown).toContain('| 2026 | 38 |');
  });

  it('preserves the actual Chart payload as a Markdown data table without executing JSX', () => {
    const chart = {
      chartType: 'line',
      meta: { title: 'SyncNos 图表真机测试' },
      xKey: 'year',
      series: [{ dataKey: 'value', label: '数值' }],
      data: [
        { year: '2021', value: 11 },
        { year: '2022', value: 18 },
        { year: '2026', value: 38 },
      ],
    };
    const markup = '<Chart content={' + JSON.stringify(chart) + '}/>';
    const result = build(
      pagedFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({
          id: 'assistant-1',
          role: 'assistant',
          channel: 'final',
          parts: [['图表如下', markup, '', '```jsx', markup, '```', '图表结束'].join('\n')],
        }),
      ]),
    );
    const content = result.snapshot.messages[1].contentMarkdown;
    expect(content).toContain('**SyncNos 图表真机测试**（折线图）');
    expect(content).toContain('| year | 数值 (value) |');
    expect(content).toContain('| 2021 | 11 |');
    expect(content).toContain('| 2022 | 18 |');
    expect(content).toContain('| 2026 | 38 |');
    expect(content).toContain('```jsx\n' + markup + '\n```');
    expect(content).not.toContain('[图表：请在原对话查看]');
    expect(result.snapshot.captureMeta.completeness).toBe('complete');
  });

  it('preserves multi-series, pie and scatter chart values and non-JSON expressions', () => {
    const pie =
      '<Chart content={' +
      JSON.stringify({
        chartType: 'pie',
        nameKey: 'name',
        valueKey: 'amount',
        data: [
          { name: '北区', amount: 25 },
          { name: '南区', amount: 75 },
        ],
      }) +
      '}/>';
    const scatter =
      '<Chart content={' +
      JSON.stringify({
        chartType: 'scatter',
        xKey: 'x',
        series: [{ dataKey: 'y' }, { dataKey: 'z' }],
        data: [{ x: 1, y: 2, z: 3 }],
      }) +
      '}/>';
    const dynamic = '<Chart content={chartState.data}/>';
    const result = build(
      pagedFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({
          id: 'assistant-1',
          role: 'assistant',
          channel: 'final',
          parts: [[pie, scatter, dynamic].join('\n\n')],
        }),
      ]),
    );
    const content = result.snapshot.messages[1].contentMarkdown;
    expect(content).toContain('| name | amount |');
    expect(content).toContain('| 北区 | 25 |');
    expect(content).toContain('| x | y | z |');
    expect(content).toContain('| 1 | 2 | 3 |');
    expect(content).toContain(dynamic);
  });

  it('keeps native UI tables and map locations as data', () => {
    const mapPoints = [
      { id: 'a', name: '地点 A', address: '测试大道 1 号', lat: 31.2, long: 121.4 },
      { id: 'b', name: '地点 B', ref: 'turn0business0' },
    ];
    const source = [
      '<table><table-row><table-cell header>年份</table-cell><table-cell header>收入</table-cell></table-row><table-row><table-cell>2025</table-cell><table-cell>100</table-cell></table-row></table>',
      '<MapWidgetV2 points={' + JSON.stringify(mapPoints) + '}/>',
    ].join('\n');
    const result = build(
      pagedFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: [source] }),
      ]),
    );
    const text = result.snapshot.messages[1].contentMarkdown;
    expect(text).toContain('| 年份 | 收入 |');
    expect(text).toContain('| 2025 | 100 |');
    expect(text).toContain('**地图地点数据**');
    expect(text).toContain('| 地点 A | 测试大道 1 号 | 31.2 | 121.4 |');
    expect(text).toContain('| 地点 B | turn0business0 |  |  |');
    expect(text).not.toContain('<table-cell');
    expect(text).not.toContain('<MapWidgetV2');
  });

  it('flattens rendered Rich UI layout markup while preserving prose and fenced code', () => {
    const original = [
      '说明：',
      '',
      '<box gap={2}>',
      '  <row justify="center">',
      '    <icon name="arrow-down"/>',
      '  </row>',
      '  <grid columns={2}>',
      '    <grid-item><box>步骤一</box></grid-item>',
      '    <grid-item><box>步骤二</box></grid-item>',
      '  </grid>',
      '  <AsyncImage query="架构图"/>',
      '</box>',
      '',
      '```html',
      '<box>这是代码示例</box>',
      '```',
    ].join('\n');
    const result = build(
      pagedFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: [original] }),
      ]),
    );
    const rendered = result.snapshot.messages[1].contentMarkdown;
    expect(rendered).toContain('说明：');
    expect(rendered).toContain('↓');
    expect(rendered).toContain('步骤一');
    expect(rendered).toContain('步骤二');
    expect(rendered).toContain('图片：架构图');
    expect(rendered).not.toContain('<grid columns');
    expect(rendered).toContain('```html\n<box>这是代码示例</box>\n```');
    expect(result.snapshot.captureMeta.completeness).toBe('complete');
  });

  it('preserves rich ChatGPT steps, references and tables as readable Markdown', () => {
    const source = [
      '## Abaqus 流程',
      '<row align="start">',
      '  <box flex="1">',
      '      **第 1 步：建立试样**',
      '',
      '      | 参数 | 数值 |',
      '      | --- | --- |',
      '      | 半径 | 25 mm |',
      '',
      '      求解 \\(K\\)。',
      '  </box>',
      '</row>',
      '<divider color="subtle"/>',
      '参考 <Cite ref="turn0search0"/>',
      '<Link url="https://example.com/paper" title="论文"/>',
    ].join('\n');
    const result = build(
      pagedFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: [source] }),
      ]),
    );
    const markdown = result.snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('| 半径 | 25 mm |');
    expect(markdown).toContain('**第 1 步：建立试样**');
    expect(markdown).toContain('[论文](<https://example.com/paper>)');
    expect(markdown).toContain('（引用见原对话）');
    expect(markdown).not.toMatch(/^ {4,}\*\*第 1 步/m);
    expect(markdown).not.toMatch(/<(?:row|box|divider|Cite|Link)\b/);
  });

  it('downgrades malformed parts and attachment containers without aborting the conversation', () => {
    const malformedParts = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    malformedParts.messages[0]!.content.parts = { text: 'not-an-array' };
    const partsResult = build(malformedParts);
    expect(partsResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'assistant-1', contentMarkdown: 'a' }),
    ]);
    expect(partsResult.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_schema_drift_partial'],
    });

    const malformedAttachments = pagedFrom([
      message({ id: 'user-1', role: 'user', contentType: 'multimodal_text', parts: ['q'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    malformedAttachments.messages[0]!.metadata.attachments = { id: 'file_image_1' };
    const attachmentsResult = build(malformedAttachments);
    expect(attachmentsResult.snapshot.messages.map((entry: any) => entry.contentMarkdown)).toEqual(['q', 'a']);
    expect(attachmentsResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('keeps top-level text as a partial schema-drift fallback when parts are absent', () => {
    const data = pagedFrom([message({ id: 'user-1', role: 'user' })]);
    data.messages[0]!.content.text = 'fallback text';
    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'fallback text' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_schema_drift_partial'],
    });
  });

  it('requires the current conversation_id response identity', () => {
    const data = pagedFrom([message({ id: 'user-1', role: 'user', parts: ['question'] })]);
    delete data.conversation_id;
    data.id = 'conversation-1';
    expect(errorCode(() => build(data))).toBe('conversation_identity_mismatch');
  });

  it('renders backend rich references as readable Markdown instead of leaking transport tokens', () => {
    const cite = 'citeturn1search0turn1search1';
    const widget =
      'genui{"chart":{"meta":{"title":"Price history","description":"Standard price, not sale price"},"data":[{"x":1,"y":2}]}}';
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        channel: 'final',
        parts: [`Answer ${cite}\n\n${widget}`],
        contentReferences: [
          {
            type: 'grouped_webpages',
            matched_text: cite,
            alt: '([Primary](https://example.com/primary))',
            safe_urls: ['https://example.com/primary'],
            items: [
              {
                attribution: 'Primary',
                title: 'Primary source',
                url: 'https://example.com/primary',
                supporting_websites: [{ attribution: 'Supporting', url: 'https://example.com/supporting' }],
              },
            ],
          },
          { type: 'client_defined_widget', matched_text: widget },
        ],
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages[1].contentMarkdown).toBe(
      'Answer [Primary+1](https://example.com/primary)\n\nPrice history — Standard price, not sale price',
    );
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('resolves references in prose but preserves literal markers inside fenced code', () => {
    const cite = 'citeturn1search0';
    const unknown = 'future-widgetopaque';
    const source = [`Source ${cite}`, '', '```md', `literal ${cite}`, `literal ${unknown}`, '```'].join('\n');
    const result = build(
      pagedFrom([
        message({ id: 'user', role: 'user', parts: ['question'] }),
        message({
          id: 'assistant',
          role: 'assistant',
          channel: 'final',
          parts: [source],
          contentReferences: [
            {
              type: 'grouped_webpages',
              matched_text: cite,
              items: [{ attribution: 'Paper', url: 'https://example.com/paper' }],
            },
          ],
        }),
      ]),
    );
    const saved = result.snapshot.messages[1].contentMarkdown;
    expect(saved).toContain('Source [Paper](https://example.com/paper)');
    expect(saved).toContain(`\`\`\`md\nliteral ${cite}\nliteral ${unknown}\n\`\`\``);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('keeps literal citation markers and Rich UI tags inside inline code spans', () => {
    const cite = 'citeturn1search0';
    const source = `Outside ${cite}; inline \`${cite}\` and \`<box><text>literal</text></box>\`.`;
    const result = build(
      pagedFrom([
        message({ id: 'user', role: 'user', parts: ['question'] }),
        message({
          id: 'assistant',
          role: 'assistant',
          channel: 'final',
          parts: [source],
          contentReferences: [
            {
              type: 'grouped_webpages',
              matched_text: cite,
              items: [{ attribution: 'Paper', url: 'https://example.com/paper' }],
            },
          ],
        }),
      ]),
    );
    const saved = result.snapshot.messages[1].contentMarkdown;
    expect(saved).toContain('Outside [Paper](https://example.com/paper)');
    expect(saved).toContain(`\`${cite}\``);
    expect(saved).toContain('`<box><text>literal</text></box>`');
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('keeps four-backtick fences intact when the code contains shorter backtick lines and Rich UI tags', () => {
    const source = [
      'before',
      '````md',
      '```',
      '<box><text>Literal code</text></box>',
      '````',
      'after <box><text>Rendered prose</text></box>',
    ].join('\n');
    const result = build(
      pagedFrom([
        message({ id: 'user', role: 'user', parts: ['question'] }),
        message({ id: 'assistant', role: 'assistant', channel: 'final', parts: [source] }),
      ]),
    );
    const saved = result.snapshot.messages[1].contentMarkdown;
    expect(saved).toContain('````md\n```\n<box><text>Literal code</text></box>\n````');
    expect(saved).not.toContain('<box><text>Rendered prose');
  });

  it('omits hidden reference tokens and fails soft on unknown internal rich tokens', () => {
    const hidden = 'fileciteturn1file0L1-L2';
    const unknown = 'future-widgetopaque';
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        channel: 'final',
        parts: [`before ${hidden} middle ${unknown} after`],
        contentReferences: [{ type: 'hidden', matched_text: hidden, invalid: true }],
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages[1].contentMarkdown).toBe('before  middle  after');
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('keeps an explicitly unfinished final under the turn key until the backend marks it finalized', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'], turnId: 'turn-a' }),
      message({
        id: 'assistant-streaming',
        role: 'assistant',
        channel: 'final',
        parts: ['partial answer'],
        turnId: 'turn-a',
        status: 'in_progress',
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'chatgpt-turn:turn-a',
      role: 'assistant',
      contentMarkdown: 'partial answer',
    });
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_unfinished_turn_partial'],
    });
  });

  it('preserves backend-selected message IDs without inventing a different branch', () => {
    const data = pagedFrom([
      message({ id: 'system-1', role: 'system', parts: ['internal'] }),
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({
        id: 'assistant-current',
        role: 'assistant',
        channel: 'final',
        parts: ['current answer'],
        turnId: 'turn-a',
      }),
    ]);
    const result = build(data);
    expect(result.snapshot.messages.map((entry: any) => entry.messageKey)).toEqual(['user-1', 'assistant-current']);
    expect(result.snapshot.messages.map((entry: any) => entry.contentMarkdown)).toEqual(['question', 'current answer']);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('attaches thoughts, recap and commentary to the following stable final owner in order', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({
        id: 'thought-1',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'Plan', content: 'Inspect first.' }, { summary: 'Plan' }],
        turnId: 'turn-a',
      }),
      message({
        id: 'recap-1',
        role: 'assistant',
        contentType: 'reasoning_recap',
        content: 'Reasoning recap.',
        turnId: 'turn-a',
      }),
      message({
        id: 'commentary-1',
        role: 'assistant',
        channel: 'commentary',
        parts: ['Progress update.'],
        turnId: 'turn-a',
      }),
      message({
        id: 'assistant-final',
        role: 'assistant',
        channel: 'final',
        parts: ['Final answer.'],
        turnId: 'turn-a',
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages[1]).toMatchObject({ messageKey: 'assistant-final', role: 'assistant' });
    expect(result.snapshot.messages[1].contentMarkdown).toBe(
      '**Plan**\n\nInspect first.\n\nReasoning recap.\n\nProgress update.\n\nFinal answer.',
    );
  });

  it('keeps stable visible output when reasoning schema drifts', () => {
    const unsupportedThought = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'thought-1',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ opaque_reasoning: { visible: true } }],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-final', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    const thoughtResult = build(unsupportedThought);
    expect(thoughtResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-final',
      contentMarkdown: 'answer',
    });
    expect(thoughtResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unsupportedChunk = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'thought-1',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'Plan', chunks: [{ opaque: true }] }],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-final', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    const chunkResult = build(unsupportedChunk);
    expect(chunkResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-final',
      contentMarkdown: '**Plan**\n\nanswer',
    });
    expect(chunkResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unsupportedRecap = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'recap-1', role: 'assistant', contentType: 'reasoning_recap', turnId: 'turn-a' }),
      message({ id: 'assistant-final', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    unsupportedRecap.messages[1]!.content.content = { opaque: true };
    const recapResult = build(unsupportedRecap);
    expect(recapResult.snapshot.messages.at(-1)).toMatchObject({ contentMarkdown: 'answer' });
    expect(recapResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('supports final image pointers and downgrades unfamiliar assistant image metadata', () => {
    const finalImage = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        channel: 'final',
        parts: ['answer', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
      }),
    ]);
    const finalImageResult = build(finalImage);
    const finalImageKey = buildChatgptGeneratedImageMessageKey(['file_image_1']);
    expect(finalImageResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: finalImageKey,
      role: 'assistant',
      contentMarkdown: 'answer\n\n![](chatgpt-file://file_image_1)',
    });
    expect(finalImageResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });

    const commentaryImage = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'commentary-1',
        role: 'assistant',
        channel: 'commentary',
        parts: ['progress', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    const commentaryResult = build(commentaryImage);
    expect(commentaryResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-1',
      contentMarkdown: 'progress\n\nanswer',
    });
    expect(commentaryResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const finalAttachment = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        channel: 'final',
        parts: ['answer'],
        attachments: [{ id: 'file_image_1', name: 'image.png', mime_type: 'image/png', size: 10 }],
      }),
    ]);
    const attachmentResult = build(finalAttachment);
    expect(attachmentResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-1',
      contentMarkdown: 'answer',
    });
    expect(attachmentResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('ignores opaque tool execution nodes while preserving visible assistant output', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'tool-call-1',
        role: 'assistant',
        recipient: 'api_tool.call_tool',
        channel: 'commentary',
        contentType: 'code',
        parts: ['{}'],
        turnId: 'turn-a',
      }),
      message({ id: 'tool-result-1', role: 'tool', contentType: 'code', parts: [], turnId: 'turn-a' }),
      message({
        id: 'tool-call-2',
        role: 'assistant',
        recipient: 'web.run',
        contentType: 'text',
        parts: ['opaque request'],
        turnId: 'turn-a',
      }),
      message({
        id: 'tool-result-2',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: ['opaque', 'tool', 'result'],
        turnId: 'turn-a',
      }),
      message({
        id: 'commentary',
        role: 'assistant',
        channel: 'commentary',
        parts: ['Working'],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    data.messages[2]!.content.parts = { opaque: true };

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({ messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'Working\n\nanswer' }),
    ]);
  });

  it('ignores tool-returned screenshots even when they use image_asset_pointer', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['inspect'] }),
      message({
        id: 'tool-call',
        role: 'assistant',
        recipient: 'api_tool.call_tool',
        channel: 'commentary',
        contentType: 'code',
        parts: ['{}'],
        turnId: 'turn-a',
      }),
      message({
        id: 'tool-screenshot',
        role: 'tool',
        authorName: 'api_tool.call_tool',
        channel: 'commentary',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_screenshot_1' }],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'inspect' }),
      expect.objectContaining({ messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain('file_screenshot_1');
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('handles long agentic tool pipelines without materializing internal tool nodes', () => {
    const messages: Array<ReturnType<typeof message>> = [message({ id: 'user-long', role: 'user', parts: ['q'] })];
    for (let index = 0; index < 300; index += 1) {
      messages.push(
        message({
          id: `tool-call-${index}`,
          role: 'assistant',
          recipient: 'api_tool.call_tool',
          contentType: 'code',
          parts: ['{}'],
          turnId: 'turn-long',
        }),
        message({
          id: `tool-result-${index}`,
          role: 'tool',
          contentType: index % 2 === 0 ? 'code' : 'multimodal_text',
          parts: index % 2 === 0 ? [] : ['opaque', 'tool', 'result'],
          turnId: 'turn-long',
        }),
      );
    }
    messages.push(
      message({ id: 'assistant-long', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-long' }),
    );

    const result = build(pagedFrom(messages));
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-long', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({ messageKey: 'assistant-long', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('preserves an auxiliary-only assistant turn when the next user message closes it', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({
        id: 'thoughts-only',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'visible progress', content: 'reasoning without a final message' }],
        turnId: 'turn-aux-only',
      }),
      message({
        id: 'commentary-only',
        role: 'assistant',
        channel: 'commentary',
        parts: ['tool progress'],
        turnId: 'turn-aux-only',
      }),
      message({ id: 'user-2', role: 'user', parts: ['second'] }),
      message({ id: 'assistant-2', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-2' }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'first' }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-aux-only',
        role: 'assistant',
        contentMarkdown: '**visible progress**\n\nreasoning without a final message\n\ntool progress',
      }),
      expect.objectContaining({ messageKey: 'user-2', role: 'user', contentMarkdown: 'second' }),
      expect.objectContaining({ messageKey: 'assistant-2', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('preserves visible auxiliary text under the preceding user identity when turn_id is absent', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({
        id: 'commentary-unowned',
        role: 'assistant',
        channel: 'commentary',
        parts: ['visible progress without a turn id'],
      }),
      message({ id: 'user-2', role: 'user', parts: ['second'] }),
      message({ id: 'assistant-2', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-2' }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages.map((entry: any) => entry.messageKey)).toEqual([
      'user-1',
      'chatgpt-turn:user-1',
      'user-2',
      'assistant-2',
    ]);
    expect(result.snapshot.messages[1].contentMarkdown).toBe('visible progress without a turn id');
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('preserves a terminal auxiliary-only turn without an explicit turn_id as complete history', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({
        id: 'thoughts-tail',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'Plan', content: 'still-working history from backend' }],
        status: 'finished_successfully',
      }),
      message({
        id: 'progress-tail',
        role: 'assistant',
        channel: 'commentary',
        parts: ['completed progress'],
        status: 'finished_successfully',
      }),
      message({ id: 'hidden-tool-tail', role: 'tool', hidden: true, parts: [], status: 'finished_successfully' }),
    ]);
    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'question' }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:user-1',
        role: 'assistant',
        contentMarkdown: '**Plan**\n\nstill-working history from backend\n\ncompleted progress',
      }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('keeps explicitly streaming backend content partial even when turn_id is missing', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({
        id: 'assistant-live',
        role: 'assistant',
        channel: 'commentary',
        parts: ['still generating'],
        status: 'in_progress',
      }),
    ]);
    const result = build(data);
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'chatgpt-turn:user-1',
      contentMarkdown: 'still generating',
    });
    expect(result.snapshot.captureMeta).toMatchObject({
      completeness: 'partial',
      reasons: ['chatgpt_api_unfinished_turn_partial'],
    });
  });

  it('preserves a branch-end auxiliary-only turn under a stable provisional turn key', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'thoughts-finished',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'done', content: 'completed execution-only turn' }],
        turnId: 'turn-a',
        status: 'finished_successfully',
      }),
      message({
        id: 'commentary-finished',
        role: 'assistant',
        channel: 'commentary',
        parts: ['completed progress'],
        turnId: 'turn-a',
        status: 'finished_successfully',
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-a',
        role: 'assistant',
        contentMarkdown: '**done**\n\ncompleted execution-only turn\n\ncompleted progress',
      }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('preserves readable text from unknown final content types as partial', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'assistant-future',
        role: 'assistant',
        channel: 'final',
        contentType: 'future_rich_text',
        parts: ['future answer'],
        turnId: 'turn-a',
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-future',
      role: 'assistant',
      contentMarkdown: 'future answer',
    });
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('ignores unknown roles but rejects missing transport message identities', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({ id: 'future-role', role: 'future_role', parts: ['opaque'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    expect(build(data).snapshot.messages.map((entry: any) => entry.messageKey)).toEqual(['user-1', 'assistant-1']);
    data.messages[1]!.id = '';
    expect(errorCode(() => build(data))).toBe('chatgpt_api_message_id_invalid');
  });

  it('omits unknown assistant shapes and unfinished auxiliary tails without aborting prior safe messages', () => {
    const unknownAssistant = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'assistant-unknown', role: 'assistant', contentType: 'audio', parts: [] }),
    ]);
    const unknownResult = build(unknownAssistant);
    expect(unknownResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
    ]);
    expect(unknownResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unfinishedAuxiliary = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'commentary',
        role: 'assistant',
        channel: 'commentary',
        parts: ['unfinished'],
        turnId: 'turn-a',
      }),
    ]);
    const auxiliaryResult = build(unfinishedAuxiliary);
    expect(auxiliaryResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-a',
        role: 'assistant',
        contentMarkdown: 'unfinished',
      }),
    ]);
    expect(auxiliaryResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('does not attach pending auxiliary content when a later owner loses its turn id', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({
        id: 'commentary-1',
        role: 'assistant',
        channel: 'commentary',
        parts: ['progress'],
        turnId: 'turn-a',
      }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'] }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', contentMarkdown: 'q' }),
      expect.objectContaining({ messageKey: 'assistant-1', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_unowned_auxiliary_omitted']);
  });

  it('materializes generated images independently of opaque tool-call nodes', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_generated_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
      message({
        id: 'image-recap',
        role: 'assistant',
        contentType: 'reasoning_recap',
        content: 'Generated the image.',
        turnId: 'turn-image',
      }),
      message({
        id: 'assistant-final',
        role: 'assistant',
        channel: 'final',
        parts: ['Done.'],
        turnId: 'turn-image',
      }),
    ]);

    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_generated_1']);
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: imageKey,
      role: 'assistant',
      contentMarkdown: 'Generated the image.\n\nDone.\n\n![generated image](chatgpt-file://file_generated_1)',
    });

    const missingImage = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'assistant-final',
        role: 'assistant',
        channel: 'final',
        parts: ['No image.'],
        turnId: 'turn-image',
      }),
    ]);
    expect(build(missingImage).snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'assistant-final',
      role: 'assistant',
      contentMarkdown: 'No image.',
    });
  });

  it('persists stable ChatGPT file references for user uploads and generated images without raw pointers', () => {
    const data = pagedFrom([
      message({
        id: 'user-upload',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['see image', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_user_1' }],
        attachments: [{ id: 'file_user_1', name: 'upload.png', mime_type: 'image/png', size: 42 }],
      }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-generated',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_generated_1' }],
        imageTitle: 'generated cube',
        turnId: 'turn-generated',
      }),
      message({
        id: 'assistant-final',
        role: 'assistant',
        channel: 'final',
        parts: ['Done.'],
        turnId: 'turn-generated',
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages[0].contentMarkdown).toBe('see image\n\n![upload.png](chatgpt-file://file_user_1)');
    expect(result.snapshot.messages.at(-1)?.contentMarkdown).toBe(
      'Done.\n\n![generated cube](chatgpt-file://file_generated_1)',
    );
    expect(JSON.stringify(result.snapshot)).not.toContain('sediment://');
  });

  it('preserves the same stable file reference when one ChatGPT image appears in multiple messages', () => {
    const data = pagedFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['first', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_shared_1' }],
      }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['ack'] }),
      message({
        id: 'user-2',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['second', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_shared_1' }],
      }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages[0].contentMarkdown).toContain('chatgpt-file://file_shared_1');
    expect(result.snapshot.messages.at(-1)?.contentMarkdown).toContain('chatgpt-file://file_shared_1');
  });

  it('keeps image-only turns and their stable auxiliary-only assistant output', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw it'] }),
      message({
        id: 'image-commentary',
        role: 'assistant',
        channel: 'commentary',
        parts: ['working'],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-thoughts',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'Plan', content: 'Generate image.' }],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
      message({ id: 'user-2', role: 'user', parts: ['continue'] }),
      message({ id: 'assistant-2', role: 'assistant', channel: 'final', parts: ['done'], turnId: 'turn-2' }),
    ]);

    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_only_1']);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw it' }),
      expect.objectContaining({
        messageKey: imageKey,
        role: 'assistant',
        contentMarkdown: '![generated image](chatgpt-file://file_only_1)',
      }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-image',
        role: 'assistant',
        contentMarkdown: 'working\n\n**Plan**\n\nGenerate image.',
      }),
      expect.objectContaining({ messageKey: 'user-2', role: 'user', contentMarkdown: 'continue' }),
      expect.objectContaining({ messageKey: 'assistant-2', role: 'assistant', contentMarkdown: 'done' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });

    const unfinishedAtBranchEnd = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw it'] }),
      message({
        id: 'image-commentary',
        role: 'assistant',
        channel: 'commentary',
        parts: ['working'],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const unfinishedResult = build(unfinishedAtBranchEnd);
    expect(unfinishedResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw it' }),
      expect.objectContaining({
        messageKey: imageKey,
        role: 'assistant',
        contentMarkdown: '![generated image](chatgpt-file://file_only_1)',
      }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-image',
        role: 'assistant',
        contentMarkdown: 'working',
      }),
    ]);
    expect(unfinishedResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('separates image and auxiliary state when their turn ids diverge', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw it'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
      message({
        id: 'other-recap',
        role: 'assistant',
        contentType: 'reasoning_recap',
        content: 'belongs elsewhere',
        turnId: 'turn-other',
      }),
    ]);
    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_only_1']);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw it' }),
      expect.objectContaining({
        messageKey: imageKey,
        role: 'assistant',
        contentMarkdown: '![generated image](chatgpt-file://file_only_1)',
      }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-other',
        role: 'assistant',
        contentMarkdown: 'belongs elsewhere',
      }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('dedupes repeated image-only keys as partial instead of throwing or duplicating content', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({
        id: 'image-tool-1',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_same_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-1',
      }),
      message({ id: 'user-2', role: 'user', parts: ['second'] }),
      message({
        id: 'image-tool-2',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_same_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-2',
      }),
    ]);

    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_same_1']);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', contentMarkdown: 'first' }),
      expect.objectContaining({ messageKey: imageKey, role: 'assistant' }),
      expect.objectContaining({ messageKey: 'user-2', contentMarkdown: 'second' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('uses the current DOM-compatible image-only key and records unsupported pointers for protective materialization', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw it'] }),
      message({
        id: 'image-call-only',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool-only',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' },
          { content_type: 'image_asset_pointer', asset_pointer: 'https://legacy.invalid/file.png' },
        ],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool-hidden-copy',
        role: 'tool',
        channel: 'commentary',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' }],
        hidden: true,
      }),
      message({
        id: 'image-recap',
        role: 'assistant',
        contentType: 'reasoning_recap',
        content: 'backend recap not rendered as a DOM message for the image-only turn',
        turnId: 'turn-image',
      }),
      message({
        id: 'hidden-final',
        role: 'assistant',
        channel: 'final',
        parts: ['hidden'],
        hidden: true,
      }),
    ]);

    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_only_1']);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw it' }),
      expect.objectContaining({
        messageKey: imageKey,
        role: 'assistant',
        contentMarkdown: '![generated image](chatgpt-file://file_only_1)',
      }),
      expect.objectContaining({
        messageKey: 'chatgpt-turn:turn-image',
        role: 'assistant',
        contentMarkdown: 'backend recap not rendered as a DOM message for the image-only turn',
      }),
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain('legacy.invalid');
  });

  it('ignores repeated opaque tool-call nodes before a visible generated-image result', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call-1',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-call-2',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_image_1']);
    expect(build(data).snapshot.messages.at(-1)).toMatchObject({ messageKey: imageKey, role: 'assistant' });
  });

  it('accepts a visible generated-image tool result without requiring its opaque call node', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_image_1']);
    expect(build(data).snapshot.messages.at(-1)).toMatchObject({ messageKey: imageKey, role: 'assistant' });
  });

  it('keeps recognized images when surrounding tool schema contains unfamiliar content', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'mixed-image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' },
          { content_type: 'execution_output', value: { opaque: true } },
        ],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const result = build(data);
    const imageKey = buildChatgptGeneratedImageMessageKey(['file_image_1']);
    expect(result.snapshot.messages.at(-1)).toMatchObject({ messageKey: imageKey, role: 'assistant' });
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const attachmentData = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
        attachments: [{ id: 'file_pdf_1', name: 'extra.pdf', mime_type: 'application/pdf', size: 10 }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const attachmentResult = build(attachmentData);
    expect(attachmentResult.snapshot.messages.at(-1)).toMatchObject({ messageKey: imageKey, role: 'assistant' });
    expect(attachmentResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('accepts image pointers even when ChatGPT changes the surrounding content type', () => {
    const userTextImage = pagedFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'text',
        parts: ['image', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
      }),
    ]);
    const userResult = build(userTextImage);
    expect(userResult.snapshot.messages[0]).toMatchObject({
      messageKey: 'user-1',
      contentMarkdown: 'image\n\n![](chatgpt-file://file_image_1)',
    });
    expect(userResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const toolTextImage = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const toolResult = build(toolTextImage);
    expect(toolResult.snapshot.messages.at(-1)).toMatchObject({
      messageKey: buildChatgptGeneratedImageMessageKey(['file_image_1']),
      role: 'assistant',
    });
    expect(toolResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('does not reinterpret unknown image aliases but preserves the stable turn as partial', () => {
    const typeAlias = pagedFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'multimodal_text',
        parts: [{ type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
      }),
    ]);
    const aliasResult = build(typeAlias);
    expect(aliasResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: '' }),
    ]);
    expect(aliasResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const suffixedPointer = pagedFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1?legacy=1' }],
      }),
    ]);
    const result = build(suffixedPointer);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: '' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('does not misclassify unknown image-like objects while keeping the conversation capturable', () => {
    const userData = pagedFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_analysis', content: { visible: true } }],
      }),
    ]);
    const userResult = build(userData);
    expect(userResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: '' }),
    ]);
    expect(userResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const toolData = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-analysis-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_analysis', asset_pointer: 'sediment://file_image_1' }],
        turnId: 'turn-image',
      }),
    ]);
    const toolResult = build(toolData);
    expect(toolResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw' }),
    ]);
    expect(toolResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('drops an unkeyable generated image as partial instead of aborting the conversation', () => {
    const data = pagedFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'image-call',
        role: 'assistant',
        recipient: 'opaque.image.tool',
        channel: 'commentary',
        contentType: 'code',
        parts: [],
        turnId: 'turn-image',
      }),
      message({
        id: 'image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'https://legacy.invalid/file.png' }],
        imageTitle: 'generated image',
        turnId: 'turn-image',
      }),
    ]);
    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'draw' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('does not interpret an attachment filename as executable Markdown', () => {
    const filename = '![track](https://example.com/pixel.png)_[x].json';
    const result = build(
      pagedFrom([
        message({
          id: 'user-1',
          role: 'user',
          parts: ['see file'],
          attachments: [{ id: 'file_data', name: filename, mime_type: 'application/json' }],
        }),
      ]),
    );
    const markdown = result.snapshot.messages[0].contentMarkdown;
    expect(markdown).toContain('see file');
    expect(markdown).toContain('`![track](https://example.com/pixel.png)_[x].json`');
    const tokens = new MarkdownIt({ linkify: true }).parse(markdown, {});
    const inline = tokens.flatMap((token) => token.children || []);
    expect(inline.some((token) => token.type === 'image' || token.type === 'link_open')).toBe(false);
    expect(result.snapshot.captureMeta.completeness).toBe('complete');

    const backtickName = 'a``b_[file].md';
    const backtick = build(
      pagedFrom([
        message({
          id: 'user-backtick',
          role: 'user',
          parts: ['attached'],
          attachments: [{ id: 'file_backtick', name: backtickName, mime_type: 'text/markdown' }],
        }),
      ]),
    );
    const backtickTokens = new MarkdownIt({ linkify: true }).parse(backtick.snapshot.messages[0].contentMarkdown, {});
    expect(
      backtickTokens
        .flatMap((token) => token.children || [])
        .filter((token) => token.type === 'code_inline')
        .map((token) => token.content),
    ).toEqual([backtickName]);
    expect(backtick.snapshot.captureMeta.completeness).toBe('complete');
  });

  it('keeps non-image attachments as readable filename and type without treating a complete history as partial', () => {
    const nonImage = pagedFrom([
      message({
        id: 'user-file',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['see file', { content_type: 'file_asset_pointer', asset_pointer: 'sediment://file_pdf_1' }],
        attachments: [{ id: 'file_pdf_1', name: 'document.pdf', mime_type: 'application/pdf', size: 100 }],
      }),
    ]);
    const nonImageResult = build(nonImage);
    expect(nonImageResult.snapshot.messages).toEqual([
      expect.objectContaining({
        messageKey: 'user-file',
        role: 'user',
        contentMarkdown: 'see file\n\n附件：`document.pdf`（application/pdf）',
      }),
    ]);
    expect(nonImageResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });

    const jsonData = pagedFrom([
      message({
        id: 'user-json',
        role: 'user',
        contentType: 'text',
        parts: ['attached dataset'],
        attachments: [{ id: 'file_json_1', name: 'data.json', mime_type: 'application/json' }],
      }),
    ]);
    expect(build(jsonData).snapshot).toMatchObject({
      messages: [
        expect.objectContaining({ contentMarkdown: 'attached dataset\n\n附件：`data.json`（application/json）' }),
      ],
      captureMeta: { completeness: 'complete', identityVerified: true },
    });

    const unknownMime = pagedFrom([
      message({
        id: 'user-file',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['see file'],
        attachments: [{ id: 'file_unknown_1', name: 'unknown.bin' }],
      }),
    ]);
    const unknownMimeResult = build(unknownMime);
    expect(unknownMimeResult.snapshot.messages[0]).toMatchObject({
      messageKey: 'user-file',
      contentMarkdown: 'see file',
    });
    expect(unknownMimeResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unmatchedImage = pagedFrom([
      message({
        id: 'user-image',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['image metadata without current pointer'],
        attachments: [{ id: 'file_image_1', name: 'image.png', mime_type: 'image/png', size: 100 }],
      }),
    ]);
    const unmatchedImageResult = build(unmatchedImage);
    expect(unmatchedImageResult.snapshot.messages[0]).toMatchObject({
      messageKey: 'user-image',
      contentMarkdown: 'image metadata without current pointer',
    });
    expect(unmatchedImageResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('fails closed for conversation identity, page shape and duplicate message identities', () => {
    expect(
      errorCode(() =>
        buildChatgptApiSnapshot({
          data: pagedFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]),
          conversationId: '',
          conversationUrl: 'https://chatgpt.com/c/conversation-1',
        }),
      ),
    ).toBe('conversation_identity_invalid');

    const invalidMessages = pagedFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    invalidMessages.messages = null as any;
    expect(errorCode(() => build(invalidMessages))).toBe('chatgpt_api_messages_invalid');

    const invalidCurrent = pagedFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    invalidCurrent.current_node = 'missing';
    expect(errorCode(() => build(invalidCurrent))).toBe('chatgpt_api_current_node_invalid');

    const mismatch = pagedFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    mismatch.conversation_id = 'other';
    expect(errorCode(() => build(mismatch))).toBe('conversation_identity_mismatch');

    const duplicate = pagedFrom([
      message({ id: 'same', role: 'user', parts: ['q'] }),
      message({ id: 'same', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    expect(errorCode(() => build(duplicate))).toBe('chatgpt_api_message_id_invalid');
  });
});

describe('ChatGPT paged API transport', () => {
  const base = 'https://chatgpt.com/c/conversation-1';
  const newer = [
    message({ id: 'user-2', role: 'user', parts: ['new question'] }),
    message({
      id: 'assistant-2',
      role: 'assistant',
      channel: 'final',
      parts: ['new answer'],
      status: 'finished_successfully',
    }),
  ];
  const older = [
    message({ id: 'user-1', role: 'user', parts: ['old question'] }),
    message({
      id: 'assistant-1',
      role: 'assistant',
      channel: 'final',
      parts: ['old answer'],
      status: 'finished_successfully',
    }),
  ];

  function responsePage(items: any[], hasPrevious: boolean, initial = false) {
    return {
      ...(initial ? pagedFrom(items) : {}),
      messages: items,
      page_info: {
        start_cursor: items[0]?.id,
        end_cursor: items.at(-1)?.id,
        has_previous_page: hasPrevious,
        has_next_page: !initial,
      },
    };
  }

  function requestPages(pages: any[], options?: { latestNode?: string }) {
    const first = pages.find((page) => page?.current_node);
    const calls: Array<{ conversationId: string; before?: string; numTurns: number; timeoutMs: number }> = [];
    const requestPage = vi.fn(
      async (input: { conversationId: string; before?: string; numTurns: number; timeoutMs: number }) => {
        calls.push(input);
        if (input.numTurns === 1)
          return {
            conversation_id: 'conversation-1',
            current_node: options?.latestNode || first?.current_node,
            messages: first?.messages?.slice(-1),
          };
        const page = pages.shift();
        if (page === undefined) throw new Error('unexpected API page');
        if (page instanceof Error) throw page;
        return page;
      },
    );
    return { requestPage, calls };
  }

  it('reads newest to oldest with one safe persistence callback per page', async () => {
    const { requestPage, calls } = requestPages([responsePage(newer, true, true), responsePage(older, false)]);
    const onPage = vi.fn(async () => {});
    const result = await captureCurrentChatgptConversationViaApi({
      readCurrentUrl: () => base + '?model=test#tail',
      requestPage,
      capturedAt: 10,
      onPage,
    });
    expect(calls).toEqual([
      { conversationId: 'conversation-1', numTurns: 10, timeoutMs: 30_000 },
      { conversationId: 'conversation-1', before: 'user-2', numTurns: 10, timeoutMs: 30_000 },
      { conversationId: 'conversation-1', numTurns: 1, timeoutMs: 30_000 },
    ]);
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage.mock.calls[0][0].snapshot.captureMeta.completeness).toBe('partial');
    expect(onPage.mock.calls[0][0].snapshot.messages.every((m: any) => !m.captureMergePolicy)).toBe(true);
    expect(onPage.mock.calls[1][0].snapshot.messages.every((m: any) => !m.captureMergePolicy)).toBe(true);
    expect(onPage.mock.calls[0][0].snapshot.messages.map((m: any) => m.messageKey)).toEqual(['user-2', 'assistant-2']);
    expect(onPage.mock.calls[1][0].snapshot.messages.map((m: any) => m.messageKey)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
    expect(onPage.mock.calls[0][1]).toMatchObject({ page: 1, completed: false, messagesFetched: 2 });
    expect(onPage.mock.calls[1][1]).toMatchObject({ page: 2, completed: true, messagesFetched: 4 });
    expect(result.snapshot.captureMeta).toMatchObject({ completeness: 'complete', identityVerified: true });
    expect(result.snapshot.conversation.url).toBe(base);
  });

  it('rechecks the same ChatGPT head before destructive persistence', async () => {
    let latestNode = 'assistant-2';
    const page = responsePage(newer, false, true);
    const requestPage = vi.fn(async ({ numTurns }: { numTurns: number }) =>
      numTurns === 1
        ? { conversation_id: 'conversation-1', current_node: latestNode, messages: page.messages.slice(-1) }
        : page,
    );
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta.completeness).toBe('complete');
    await expect(result.verifyCurrent?.()).resolves.toBeUndefined();
    latestNode = 'assistant-replaced-during-enrichment';
    await expect(result.verifyCurrent?.()).rejects.toMatchObject({ code: 'chatgpt_api_conversation_changed' });
    expect(requestPage).toHaveBeenCalledTimes(4);
  });

  it('rejects a same-ID head whose content or completion state changes after pagination', async () => {
    const first = responsePage(newer, false, true);
    let changedText = 'new answer';
    let changedStatus = 'finished_successfully';
    const requestPage = vi.fn(async ({ numTurns }: { numTurns: number }) =>
      numTurns === 1
        ? {
            conversation_id: 'conversation-1',
            current_node: 'assistant-2',
            messages: [{ ...newer[1], content: { content_type: 'text', parts: [changedText] }, status: changedStatus }],
          }
        : first,
    );
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta.completeness).toBe('complete');
    await expect(result.verifyCurrent()).resolves.toBeUndefined();
    changedText = 'updated after the first head check';
    await expect(result.verifyCurrent()).rejects.toMatchObject({ code: 'chatgpt_api_conversation_changed' });
    changedText = 'new answer';
    changedStatus = 'in_progress';
    await expect(result.verifyCurrent()).rejects.toMatchObject({ code: 'chatgpt_api_conversation_changed' });
  });

  it('completes when pagination reaches history end even if parent links are missing', async () => {
    const history = structuredClone([...older, ...newer]);
    history[1]!.metadata.parent_id = 'node-not-returned';
    history[2]!.metadata.parent_id = 'another-missing-parent';
    const { requestPage } = requestPages([responsePage(history, false, true)]);
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
    expect(result.snapshot.messages.map((m: any) => m.messageKey)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
  });

  it('confirms complete for an intact single ancestor chain', async () => {
    const messages = structuredClone([...older, ...newer]);
    for (let i = 1; i < messages.length; i += 1) messages[i]!.metadata.parent_id = messages[i - 1]!.id;
    const { requestPage } = requestPages([responsePage(messages, false, true)]);
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
    expect(result.snapshot.messages.every((m: any) => !m.captureMergePolicy)).toBe(true);
  });

  it('keeps ambiguous sibling branches partial even when all parents are present', async () => {
    const messages = structuredClone([...older, ...newer]);
    messages[1]!.metadata.parent_id = 'user-1';
    messages[2]!.metadata.parent_id = 'user-1';
    messages[3]!.metadata.parent_id = 'user-2';
    const { requestPage } = requestPages([responsePage(messages, false, true)]);
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta).toMatchObject({
      completeness: 'partial',
      reasons: ['chatgpt_api_branch_ambiguous'],
    });
  });

  it('reads more than 100 pages when cursors progress and the history ends normally', async () => {
    const pages = Array.from({ length: 101 }, (_, index) => {
      const messageId = `user-${101 - index}`;
      return responsePage([message({ id: messageId, role: 'user', parts: [messageId] })], index < 100, index === 0);
    });
    const { requestPage } = requestPages(pages);
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(requestPage).toHaveBeenCalledTimes(102);
    expect(result.snapshot.messages).toHaveLength(101);
    expect(result.snapshot.captureMeta.completeness).toBe('complete');
  });

  it('does not classify an active tool pipeline as complete when its nodes are not user-visible', async () => {
    for (const active of [
      message({ id: 'tool-running', role: 'tool', contentType: 'code', status: 'in_progress', hidden: true }),
      message({
        id: 'assistant-tool-call',
        role: 'assistant',
        recipient: 'python',
        contentType: 'code',
        status: 'in_progress',
      }),
    ]) {
      const page = responsePage(
        [message({ id: 'user-latest', role: 'user', parts: ['calculate'] }), active],
        false,
        true,
      );
      const { requestPage } = requestPages([page]);
      const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
      expect(result.snapshot.messages.map((m: any) => m.messageKey)).toEqual(['user-latest']);
      expect(result.snapshot.captureMeta).toMatchObject({
        completeness: 'partial',
        reasons: expect.arrayContaining(['chatgpt_api_unfinished_turn_partial']),
      });
    }
  });

  it('keeps an already saved page if later requests fail, retries transient failures only once', async () => {
    const apiError = (status: number) =>
      Object.assign(new Error('chatgpt_api_page_http'), {
        code: 'chatgpt_api_page_http',
        status,
      });
    const { requestPage, calls } = requestPages([responsePage(newer, true, true), apiError(503), apiError(503)]);
    const saved: number[] = [];
    await expect(
      captureCurrentChatgptConversationViaApi({
        readCurrentUrl: () => base,
        requestPage,
        onPage: async (_snapshot, progress) => {
          saved.push(progress.page);
        },
      }),
    ).rejects.toMatchObject({ code: 'chatgpt_api_page_http', status: 503 });
    expect(saved).toEqual([1]);
    expect(calls).toHaveLength(3);
  });

  it('does not retry forbidden or rate-limited response statuses', async () => {
    for (const status of [403, 429]) {
      const error = Object.assign(new Error('chatgpt_api_page_http'), { code: 'chatgpt_api_page_http', status });
      const { requestPage, calls } = requestPages([error]);
      await expect(
        captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage }),
      ).rejects.toMatchObject({ code: 'chatgpt_api_page_http', status });
      expect(calls).toHaveLength(1);
    }
  });

  it('rejects duplicate IDs, cursor mismatches and invalid response shape before persistence', async () => {
    for (const invalid of [
      {
        ...responsePage(newer, false, true),
        page_info: { ...responsePage(newer, false, true).page_info, start_cursor: 'wrong' },
      },
      responsePage([newer[0], newer[0]], false, true),
      { ...responsePage(newer, false, true), page_info: null },
    ]) {
      const { requestPage } = requestPages([invalid]);
      const onPage = vi.fn();
      await expect(
        captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage, onPage }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^chatgpt_api_page_/) });
      expect(onPage).not.toHaveBeenCalled();
    }
  });

  it('rejects a different server conversation ID and a changed browser route', async () => {
    const wrong = { ...responsePage(newer, false, true), conversation_id: 'other' };
    const { requestPage } = requestPages([wrong]);
    await expect(
      captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage }),
    ).rejects.toMatchObject({ code: 'chatgpt_api_conversation_identity' });
    let url = base;
    const next = requestPages([responsePage(newer, false, true)]);
    const request = async (input: Parameters<typeof next.requestPage>[0]) => {
      const result = await next.requestPage(input);
      url = 'https://chatgpt.com/c/other';
      return result;
    };
    const onPage = vi.fn();
    await expect(
      captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => url, requestPage: request, onPage }),
    ).rejects.toMatchObject({ code: 'chatgpt_api_navigation_changed' });
    expect(onPage).not.toHaveBeenCalled();
  });

  it('marks the result partial if the current node changes during pagination', async () => {
    const { requestPage } = requestPages([responsePage(newer, false, true)], { latestNode: 'new-tail' });
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.captureMeta).toMatchObject({
      completeness: 'partial',
      reasons: expect.arrayContaining(['chatgpt_api_conversation_changed']),
    });
  });

  it('preserves visible terminal progress when a hidden tool node follows it', async () => {
    const tail = [
      message({ id: 'user', role: 'user', parts: ['question'] }),
      message({ id: 'assistant-work', role: 'assistant', channel: 'commentary', parts: ['Working'], turnId: 'turn-a' }),
      message({ id: 'tool', role: 'tool', contentType: 'text', turnId: 'turn-a', hidden: true }),
    ];
    const { requestPage } = requestPages([responsePage(tail, false, true)]);
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage });
    expect(result.snapshot.messages[0]).toMatchObject({ messageKey: 'user' });
    expect(result.snapshot.messages[1]).toMatchObject({
      messageKey: 'chatgpt-turn:turn-a',
      role: 'assistant',
      contentMarkdown: 'Working',
    });
  });

  it('defers persistence until any page actually yields a visible user or assistant', async () => {
    const tool = message({ id: 'tool-only', role: 'tool', parts: ['internal'], hidden: true });
    const { requestPage } = requestPages([responsePage([tool], true, true), responsePage(older, false)]);
    const onPage = vi.fn(async () => {});
    const result = await captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => base, requestPage, onPage });
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(result.snapshot.messages.map((m: any) => m.messageKey)).toEqual(['user-1', 'assistant-1']);
  });

  it('does not retry a rejected persistence callback as though it were a network error', async () => {
    const { requestPage, calls } = requestPages([responsePage(newer, false, true)]);
    await expect(
      captureCurrentChatgptConversationViaApi({
        readCurrentUrl: () => base,
        requestPage,
        onPage: async () => {
          throw new Error('database unavailable');
        },
      }),
    ).rejects.toThrow('database unavailable');
    expect(calls).toHaveLength(2);
  });

  it('rejects non-durable routes before querying the API', async () => {
    const requestPage = vi.fn();
    for (const url of [
      'https://chatgpt.com/',
      'https://chatgpt.com/share/a',
      'https://chatgpt.com/?temporary-chat=true',
    ]) {
      await expect(
        captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => url, requestPage }),
      ).rejects.toMatchObject({ code: 'chatgpt_api_navigation_changed' });
    }
    expect(requestPage).not.toHaveBeenCalled();
  });
});

describe('ChatGPT API capture setting', () => {
  it('is strict true only and propagates storage infrastructure failures', async () => {
    storageMocks.get.mockResolvedValueOnce({ [CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]: true });
    await expect(readChatgptApiCaptureEnabled()).resolves.toBe(true);
    storageMocks.get.mockResolvedValueOnce({ [CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]: 'true' });
    await expect(readChatgptApiCaptureEnabled()).resolves.toBe(false);
    storageMocks.get.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(readChatgptApiCaptureEnabled()).rejects.toThrow('storage unavailable');
  });

  it('writes only booleans to the canonical unversioned key', async () => {
    await expect(writeChatgptApiCaptureEnabled(true)).resolves.toBe(true);
    expect(storageMocks.set).toHaveBeenCalledWith({ chatgpt_api_capture_enabled: true });
    await expect(writeChatgptApiCaptureEnabled('true' as any)).rejects.toThrow('requires a boolean');
  });
});

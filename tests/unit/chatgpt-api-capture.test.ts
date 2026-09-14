import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      ...(input.imageTitle ? { image_gen_title: input.imageTitle } : null),
    },
  };
}

function mappingFrom(messages: Array<ReturnType<typeof message>>, currentIndex = messages.length - 1) {
  const mapping: Record<string, any> = {};
  messages.forEach((entry, index) => {
    const nodeId = `n${index + 1}`;
    mapping[nodeId] = { id: nodeId, parent: index ? `n${index}` : null, children: [], message: entry };
    if (index) mapping[`n${index}`].children.push(nodeId);
  });
  return {
    conversation_id: 'conversation-1',
    title: 'API Conversation',
    mapping,
    current_node: `n${currentIndex + 1}`,
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
  it('downgrades malformed parts and attachment containers without aborting the conversation', () => {
    const malformedParts = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    malformedParts.mapping.n1.message.content.parts = { text: 'not-an-array' };
    const partsResult = build(malformedParts);
    expect(partsResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'assistant-1', contentMarkdown: 'a' }),
    ]);
    expect(partsResult.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_schema_drift_partial'],
    });

    const malformedAttachments = mappingFrom([
      message({ id: 'user-1', role: 'user', contentType: 'multimodal_text', parts: ['q'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    malformedAttachments.mapping.n1.message.metadata.attachments = { id: 'file_image_1' };
    const attachmentsResult = build(malformedAttachments);
    expect(attachmentsResult.snapshot.messages.map((entry: any) => entry.contentMarkdown)).toEqual(['q', 'a']);
    expect(attachmentsResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('uses legacy top-level text only as a partial schema-drift fallback', () => {
    const data = mappingFrom([message({ id: 'user-1', role: 'user' })]);
    data.mapping.n1.message.content.text = 'legacy text';
    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'legacy text' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_schema_drift_partial'],
    });
  });

  it('uses only current conversation_id response identity and ignores legacy id aliases', () => {
    const data = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['question'] })]);
    delete data.conversation_id;
    data.id = 'other';
    expect(build(data).snapshot.messages.map((entry: any) => entry.messageKey)).toEqual(['user-1']);
  });

  it('keeps only the current branch and preserves stable DOM-compatible message ids', () => {
    const data = mappingFrom([
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
    data.mapping['sibling'] = {
      id: 'sibling',
      parent: 'n2',
      children: [],
      message: message({
        id: 'assistant-regenerated-away',
        role: 'assistant',
        channel: 'final',
        parts: ['old answer'],
        turnId: 'turn-old',
      }),
    };
    data.mapping.n2.children.push('sibling');

    const result = build(data);
    expect(result.snapshot.messages.map((entry: any) => entry.messageKey)).toEqual(['user-1', 'assistant-current']);
    expect(result.snapshot.messages.map((entry: any) => entry.contentMarkdown)).toEqual(['question', 'current answer']);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('attaches thoughts, recap and commentary to the following stable final owner in order', () => {
    const data = mappingFrom([
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
    const unsupportedThought = mappingFrom([
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

    const unsupportedChunk = mappingFrom([
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

    const unsupportedRecap = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'recap-1', role: 'assistant', contentType: 'reasoning_recap', turnId: 'turn-a' }),
      message({ id: 'assistant-final', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    unsupportedRecap.mapping.n2.message.content.content = { opaque: true };
    const recapResult = build(unsupportedRecap);
    expect(recapResult.snapshot.messages.at(-1)).toMatchObject({ contentMarkdown: 'answer' });
    expect(recapResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('supports final image pointers and downgrades unfamiliar assistant image metadata', () => {
    const finalImage = mappingFrom([
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
      contentMarkdown: 'answer',
    });
    expect(finalImageResult.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });

    const commentaryImage = mappingFrom([
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

    const finalAttachment = mappingFrom([
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
    const data = mappingFrom([
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
    data.mapping.n3.message.content.parts = { opaque: true };

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({ messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'Working\n\nanswer' }),
    ]);
  });

  it('ignores tool-returned screenshots even when they use image_asset_pointer', () => {
    const data = mappingFrom([
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
    expect(result.chatgptProtectedImages).toBeNull();
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

    const result = build(mappingFrom(messages));
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-long', role: 'user', contentMarkdown: 'q' }),
      expect.objectContaining({ messageKey: 'assistant-long', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({ completeness: 'complete', identityVerified: true });
  });

  it('drops unowned auxiliary execution state at the next user boundary', () => {
    const data = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({
        id: 'thoughts-orphan',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'internal', content: 'not owned by a visible assistant message' }],
        turnId: 'turn-orphan',
      }),
      message({
        id: 'commentary-orphan',
        role: 'assistant',
        channel: 'commentary',
        parts: ['progress only'],
        turnId: 'turn-orphan',
      }),
      message({ id: 'user-2', role: 'user', parts: ['second'] }),
      message({ id: 'assistant-2', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-2' }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'first' }),
      expect.objectContaining({ messageKey: 'user-2', role: 'user', contentMarkdown: 'second' }),
      expect.objectContaining({ messageKey: 'assistant-2', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_unowned_auxiliary_omitted'],
    });
  });

  it('drops a completed auxiliary-only turn at branch end when every node is explicitly finished', () => {
    const data = mappingFrom([
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
    ]);
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_unowned_auxiliary_omitted'],
    });
  });

  it('preserves readable text from unknown final content types as partial', () => {
    const data = mappingFrom([
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

  it('skips unknown roles and missing message ids without aborting safe history', () => {
    const data = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['first'] }),
      message({ id: 'future-role', role: 'future_role', parts: ['opaque'] }),
      message({ id: '', role: 'user', parts: ['missing id'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);

    const result = build(data);
    expect(result.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'first' }),
      expect.objectContaining({ messageKey: 'assistant-1', role: 'assistant', contentMarkdown: 'answer' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('omits unknown assistant shapes and unfinished auxiliary tails without aborting prior safe messages', () => {
    const unknownAssistant = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['q'] }),
      message({ id: 'assistant-unknown', role: 'assistant', contentType: 'audio', parts: [] }),
    ]);
    const unknownResult = build(unknownAssistant);
    expect(unknownResult.snapshot.messages).toEqual([
      expect.objectContaining({ messageKey: 'user-1', role: 'user', contentMarkdown: 'q' }),
    ]);
    expect(unknownResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unfinishedAuxiliary = mappingFrom([
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
    ]);
    expect(auxiliaryResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_unowned_auxiliary_omitted']);
  });

  it('does not attach pending auxiliary content when a later owner loses its turn id', () => {
    const data = mappingFrom([
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
    const data = mappingFrom([
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
      contentMarkdown: 'Generated the image.\n\nDone.',
    });
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ fileId: 'file_generated_1', targetMessageKey: imageKey }),
    ]);

    const missingImage = mappingFrom([
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

  it('builds transient sidecars for user uploads and generated images without exposing raw pointers in the snapshot', () => {
    const data = mappingFrom([
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
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({
        fileId: 'file_user_1',
        cacheKey: 'chatgpt-file://file_user_1',
        targetMessageKey: 'user-upload',
        alt: 'upload.png',
        mimeType: 'image/png',
        sizeBytes: 42,
      }),
      expect.objectContaining({
        fileId: 'file_generated_1',
        cacheKey: 'chatgpt-file://file_generated_1',
        targetMessageKey: buildChatgptGeneratedImageMessageKey(['file_generated_1']),
        alt: 'generated cube',
      }),
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain('sediment://');
    expect(JSON.stringify(result.snapshot)).not.toContain('file_user_1');
    expect(JSON.stringify(result.snapshot)).not.toContain('file_generated_1');
  });

  it('preserves distinct message bindings when the same protected file resource is referenced more than once', () => {
    const data = mappingFrom([
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
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ cacheKey: 'chatgpt-file://file_shared_1', targetMessageKey: 'user-1' }),
      expect.objectContaining({ cacheKey: 'chatgpt-file://file_shared_1', targetMessageKey: 'user-2' }),
    ]);
  });

  it('keeps image-only turns when same-turn auxiliary output has no stable owner', () => {
    const data = mappingFrom([
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
      expect.objectContaining({ messageKey: imageKey, role: 'assistant', contentMarkdown: '' }),
      expect.objectContaining({ messageKey: 'user-2', role: 'user', contentMarkdown: 'continue' }),
      expect.objectContaining({ messageKey: 'assistant-2', role: 'assistant', contentMarkdown: 'done' }),
    ]);
    expect(result.snapshot.captureMeta).toEqual({
      completeness: 'partial',
      identityVerified: true,
      reasons: ['chatgpt_api_unowned_auxiliary_omitted'],
    });
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ fileId: 'file_only_1', targetMessageKey: imageKey }),
    ]);

    const unfinishedAtBranchEnd = mappingFrom([
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
      expect.objectContaining({ messageKey: imageKey, role: 'assistant', contentMarkdown: '' }),
    ]);
    expect(unfinishedResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_unowned_auxiliary_omitted']);
  });

  it('separates image and auxiliary state when their turn ids diverge', () => {
    const data = mappingFrom([
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
      expect.objectContaining({ messageKey: imageKey, role: 'assistant', contentMarkdown: '' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_unowned_auxiliary_omitted']);
  });

  it('dedupes repeated image-only keys as partial instead of throwing or duplicating content', () => {
    const data = mappingFrom([
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
    const data = mappingFrom([
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
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: imageKey,
      role: 'assistant',
      contentMarkdown: '',
    });
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ fileId: 'file_only_1', targetMessageKey: imageKey }),
      expect.objectContaining({
        fileId: '',
        cacheKey: '',
        targetMessageKey: imageKey,
      }),
    ]);
  });

  it('ignores repeated opaque tool-call nodes before a visible generated-image result', () => {
    const data = mappingFrom([
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
    const data = mappingFrom([
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
    const data = mappingFrom([
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

    const attachmentData = mappingFrom([
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
    const userTextImage = mappingFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'text',
        parts: ['image', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' }],
      }),
    ]);
    const userResult = build(userTextImage);
    expect(userResult.snapshot.messages[0]).toMatchObject({ messageKey: 'user-1', contentMarkdown: 'image' });
    expect(userResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const toolTextImage = mappingFrom([
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
    const typeAlias = mappingFrom([
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

    const suffixedPointer = mappingFrom([
      message({
        id: 'user-1',
        role: 'user',
        contentType: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1?legacy=1' }],
      }),
    ]);
    const result = build(suffixedPointer);
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ fileId: '', cacheKey: '', targetMessageKey: 'user-1' }),
    ]);
    expect(result.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);
  });

  it('does not misclassify unknown image-like objects while keeping the conversation capturable', () => {
    const userData = mappingFrom([
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
    expect(userResult.chatgptProtectedImages).toBeNull();

    const toolData = mappingFrom([
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
    const data = mappingFrom([
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
    expect(result.chatgptProtectedImages).toBeNull();
  });

  it('keeps text when non-image or unmatched attachment metadata is unsupported', () => {
    const nonImage = mappingFrom([
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
      expect.objectContaining({ messageKey: 'user-file', role: 'user', contentMarkdown: 'see file' }),
    ]);
    expect(nonImageResult.snapshot.captureMeta.reasons).toEqual(['chatgpt_api_schema_drift_partial']);

    const unknownMime = mappingFrom([
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

    const unmatchedImage = mappingFrom([
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

  it('still fails closed for conversation identity, mapping topology and duplicate stable message keys', () => {
    expect(
      errorCode(() =>
        buildChatgptApiSnapshot({
          data: mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]),
          conversationId: '',
          conversationUrl: 'https://chatgpt.com/c/conversation-1',
        }),
      ),
    ).toBe('conversation_identity_invalid');

    const invalidMapping = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    invalidMapping.mapping = null as any;
    expect(errorCode(() => build(invalidMapping))).toBe('mapping_invalid');

    const invalidCurrent = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    invalidCurrent.current_node = 'missing';
    expect(errorCode(() => build(invalidCurrent))).toBe('mapping_current_node_invalid');

    const mismatch = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    mismatch.conversation_id = 'other';
    expect(errorCode(() => build(mismatch))).toBe('conversation_identity_mismatch');

    const missingParent = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    missingParent.mapping.n1.parent = 'missing';
    expect(errorCode(() => build(missingParent))).toBe('mapping_parent_missing');

    const cycle = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['q'] })]);
    cycle.mapping.n1.parent = 'n1';
    expect(errorCode(() => build(cycle))).toBe('mapping_cycle');

    const duplicate = mappingFrom([
      message({ id: 'same', role: 'user', parts: ['q'] }),
      message({ id: 'same', role: 'assistant', channel: 'final', parts: ['a'] }),
    ]);
    expect(errorCode(() => build(duplicate))).toBe('duplicate_message_key');
  });
});

describe('ChatGPT API transport', () => {
  it('invokes native-style fetch without rebinding its receiver', async () => {
    const mapping = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    let callCount = 0;
    const fetchFn = async function receiverSensitiveFetch(this: unknown, input: RequestInfo | URL) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      callCount += 1;
      if (String(input).endsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      }
      return new Response(JSON.stringify(mapping), { status: 200 });
    } as typeof fetch;

    await expect(
      captureCurrentChatgptConversationViaApi({
        readCurrentUrl: () => 'https://chatgpt.com/c/conversation-1',
        fetchFn,
      }),
    ).resolves.toMatchObject({ applicable: true });
    expect(callCount).toBe(2);
  });

  it('uses session cookies plus Bearer mapping only, never returns credentials, and never calls paged endpoints', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const token = 'ACCESS_TOKEN_SENTINEL';
    const mapping = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['question'] }),
      message({ id: 'assistant-1', role: 'assistant', channel: 'final', parts: ['answer'], turnId: 'turn-a' }),
    ]);
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: token }), { status: 200 });
      }
      return new Response(JSON.stringify(mapping), { status: 200 });
    }) as typeof fetch;

    const result = await captureCurrentChatgptConversationViaApi({
      readCurrentUrl: () => 'https://chatgpt.com/c/conversation-1?model=test#tail',
      fallbackTitle: 'Fallback',
      fetchFn,
      capturedAt: 10,
    });

    expect(result.applicable).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      'https://chatgpt.com/api/auth/session',
      'https://chatgpt.com/backend-api/conversation/conversation-1',
    ]);
    expect(calls[0].init).toMatchObject({ credentials: 'include' });
    const headers = new Headers(calls[1].init.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.has('ChatGPT-Account-Id')).toBe(false);
    expect(headers.has('oai-device-id')).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('/backend-api/conversations/');
    if (result.applicable) expect(result.snapshot.conversation.url).toBe('https://chatgpt.com/c/conversation-1');
  });

  it('is not applicable to temporary/share/root routes and does not fetch', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    for (const url of [
      'https://chatgpt.com/?temporary-chat=true',
      'https://chatgpt.com/share/share-id',
      'https://chatgpt.com/',
    ]) {
      await expect(captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => url, fetchFn })).resolves.toEqual({
        applicable: false,
      });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails before returning a snapshot when SPA navigation changes the durable conversation id', async () => {
    let currentUrl = 'https://chatgpt.com/c/conversation-1';
    const mapping = mappingFrom([message({ id: 'user-1', role: 'user', parts: ['question'] })]);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      currentUrl = 'https://chatgpt.com/c/conversation-2';
      return new Response(JSON.stringify(mapping), { status: 200 });
    }) as typeof fetch;

    await expect(
      captureCurrentChatgptConversationViaApi({ readCurrentUrl: () => currentUrl, fetchFn }),
    ).rejects.toMatchObject({ code: 'chatgpt_api_navigation_changed' });
  });

  it('uses safe error codes without embedding response bodies', async () => {
    const fetchFn = vi.fn(async () => new Response('PRIVATE_RESPONSE_SENTINEL', { status: 401 })) as typeof fetch;
    await expect(
      captureCurrentChatgptConversationViaApi({
        readCurrentUrl: () => 'https://chatgpt.com/c/conversation-1',
        fetchFn,
      }),
    ).rejects.toMatchObject({ code: 'chatgpt_api_session_http', status: 401 });
    await expect(
      captureCurrentChatgptConversationViaApi({
        readCurrentUrl: () => 'https://chatgpt.com/c/conversation-1',
        fetchFn,
      }),
    ).rejects.not.toThrow('PRIVATE_RESPONSE_SENTINEL');
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

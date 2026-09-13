import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCurrentChatgptConversationViaApi } from '@services/integrations/chatgpt/api-capture';
import { buildChatgptApiSnapshot } from '@services/integrations/chatgpt/api-snapshot';
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
};

function message(input: MessageInput) {
  return {
    id: input.id,
    author: { role: input.role },
    recipient: input.recipient ?? 'all',
    ...(input.channel ? { channel: input.channel } : null),
    content: {
      content_type: input.contentType || 'text',
      ...(input.parts ? { parts: input.parts } : null),
      ...(input.content != null ? { content: input.content } : null),
      ...(input.thoughts ? { thoughts: input.thoughts } : null),
    },
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

  it('fails fast for visible tool calls, ordinary tool turns, unknown assistant content, and unowned auxiliary output', () => {
    const cases = [
      mappingFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({
          id: 'tool-call',
          role: 'assistant',
          recipient: 'api_tool.call_tool',
          contentType: 'code',
          parts: ['{}'],
        }),
      ]),
      mappingFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({ id: 'tool-result', role: 'tool', contentType: 'text', parts: ['tool summary'] }),
      ]),
      mappingFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({ id: 'assistant-unknown', role: 'assistant', contentType: 'audio', parts: [] }),
      ]),
      mappingFrom([
        message({ id: 'user-1', role: 'user', parts: ['q'] }),
        message({
          id: 'commentary',
          role: 'assistant',
          channel: 'commentary',
          parts: ['unfinished'],
          turnId: 'turn-a',
        }),
      ]),
    ];

    expect(errorCode(() => build(cases[0]))).toBe('unsupported_tool_turn');
    expect(errorCode(() => build(cases[1]))).toBe('unsupported_tool_turn');
    expect(errorCode(() => build(cases[2]))).toBe('unsupported_content');
    expect(errorCode(() => build(cases[3]))).toBe('unsupported_content');
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
        targetMessageKey: 'assistant-final',
        alt: 'generated cube',
      }),
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain('sediment://');
    expect(JSON.stringify(result.snapshot)).not.toContain('file_user_1');
    expect(JSON.stringify(result.snapshot)).not.toContain('file_generated_1');
  });

  it('uses the current DOM-compatible image-only key and records unsupported pointers for protective materialization', () => {
    const data = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw it'] }),
      message({
        id: 'image-tool-only',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_only_1' },
          { content_type: 'image_asset_pointer', asset_pointer: 'https://legacy.invalid/file.png' },
        ],
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
    expect(result.snapshot.messages.at(-1)).toMatchObject({
      messageKey: 'image-tool-only:assistant:0',
      role: 'assistant',
      contentMarkdown: '',
    });
    expect(result.chatgptProtectedImages?.assets).toEqual([
      expect.objectContaining({ fileId: 'file_only_1', targetMessageKey: 'image-tool-only:assistant:0' }),
      expect.objectContaining({
        fileId: '',
        failureReason: 'unsupported_pointer',
        targetMessageKey: 'image-tool-only:assistant:0',
      }),
    ]);
  });

  it('fails when an image tool also contains any non-image part instead of silently dropping it', () => {
    const data = mappingFrom([
      message({ id: 'user-1', role: 'user', parts: ['draw'] }),
      message({
        id: 'mixed-image-tool',
        role: 'tool',
        contentType: 'multimodal_text',
        parts: [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_image_1' },
          { content_type: 'execution_output', value: { opaque: true } },
        ],
      }),
    ]);
    expect(errorCode(() => build(data))).toBe('unsupported_tool_turn');
  });

  it('fails instead of misclassifying non-image attachment pointers as images', () => {
    const data = mappingFrom([
      message({
        id: 'user-file',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['see file', { content_type: 'file_asset_pointer', asset_pointer: 'sediment://file_pdf_1' }],
        attachments: [{ id: 'file_pdf_1', name: 'document.pdf', mime_type: 'application/pdf', size: 100 }],
      }),
    ]);
    expect(errorCode(() => build(data))).toBe('unsupported_content');
  });

  it('rejects mapping identity, missing parents, cycles and duplicate stable message keys', () => {
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
  it('is strict true only and fails closed to DOM when storage cannot be read', async () => {
    storageMocks.get.mockResolvedValueOnce({ [CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]: true });
    await expect(readChatgptApiCaptureEnabled()).resolves.toBe(true);
    storageMocks.get.mockResolvedValueOnce({ [CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]: 'true' });
    await expect(readChatgptApiCaptureEnabled()).resolves.toBe(false);
    storageMocks.get.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(readChatgptApiCaptureEnabled()).resolves.toBe(false);
  });

  it('writes only booleans to the canonical unversioned key', async () => {
    await expect(writeChatgptApiCaptureEnabled(true)).resolves.toBe(true);
    expect(storageMocks.set).toHaveBeenCalledWith({ chatgpt_api_capture_enabled: true });
    await expect(writeChatgptApiCaptureEnabled('true' as any)).rejects.toThrow('requires a boolean');
  });
});

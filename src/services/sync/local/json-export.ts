import { getConversationDetail } from '@services/conversations/client/repo';
import type { Conversation, ConversationMessage } from '@services/conversations/domain/models';
import {
  ARTICLE_KIND_ID,
  CHAT_KIND_ID,
  VIDEO_KIND_ID,
  conversationKinds,
} from '@services/protocols/conversation-kinds';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import {
  claimUniqueConversationExportBasename,
  materializeConversationMarkdownAssets,
  type MaterializedExportAttachment,
} from '@services/sync/local/export-shared';

type JsonContent = {
  format: 'markdown' | 'text';
  value: string;
} | null;

type JsonAttachment = {
  path: string;
  mediaType: string;
  byteSize: number;
};

type JsonCommon = {
  schemaVersion: 1;
  type: 'chat' | 'article' | 'video';
  source: string;
  key: string;
  title: string | null;
  url: string | null;
  capturedAt: string | null;
  warnings: string[];
  attachments: JsonAttachment[];
};

type JsonChatItem = JsonCommon & {
  type: 'chat';
  messages: Array<{
    key: string;
    role: string;
    author: string | null;
    content: JsonContent;
  }>;
};

type JsonArticleItem = JsonCommon & {
  type: 'article';
  author: string | null;
  publishedAt: string | null;
  content: JsonContent;
};

type JsonVideoItem = JsonCommon & {
  type: 'video';
  author: string | null;
  transcript: JsonContent;
};

type JsonExportItem = JsonChatItem | JsonArticleItem | JsonVideoItem;

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`Invalid ${field}`);
  return normalized;
}

function nullableMetadataString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function contentString(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  return value;
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((warning) => {
    if (typeof warning !== 'string') return [];
    const normalized = warning.trim();
    return normalized ? [normalized] : [];
  });
}

function normalizeCapturedAt(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  try {
    return new Date(value).toISOString();
  } catch (_error) {
    return null;
  }
}

function normalizeContent(message: ConversationMessage | null | undefined): JsonContent {
  const markdown = contentString(message?.contentMarkdown, 'contentMarkdown');
  const text = contentString(message?.contentText, 'contentText');
  if (markdown != null) return { format: 'markdown', value: markdown };
  if (text != null) return { format: 'text', value: text };
  return null;
}

function findSemanticMessage(messages: ConversationMessage[], messageKey: string): ConversationMessage | null {
  const semantic = messages.find((message) => message.messageKey === messageKey);
  return semantic || messages[0] || null;
}

async function materializeContentMarkdown(input: {
  conversationId: number;
  basename: string;
  contents: JsonContent[];
  nextAttachmentIndex: () => number;
}): Promise<{
  contents: JsonContent[];
  attachments: JsonAttachment[];
  zipAttachments: MaterializedExportAttachment[];
}> {
  const markdown = input.contents.flatMap((content) => (content?.format === 'markdown' ? [content.value] : []));

  const materialized = await materializeConversationMarkdownAssets({
    conversationId: input.conversationId,
    basename: input.basename,
    markdown,
    nextAttachmentIndex: input.nextAttachmentIndex,
  });
  let markdownIndex = 0;
  const contents = input.contents.map((content) => {
    if (content?.format !== 'markdown') return content;
    return { ...content, value: materialized.markdown[markdownIndex++] };
  });

  return {
    contents,
    attachments: materialized.attachments.map(({ path, mediaType, byteSize }) => ({ path, mediaType, byteSize })),
    zipAttachments: materialized.attachments,
  };
}

function commonFields<T extends JsonCommon['type']>(
  conversation: Conversation,
  type: T,
): Omit<JsonCommon, 'attachments' | 'type'> & { type: T } {
  return {
    schemaVersion: 1,
    type,
    source: requireNonEmptyString(conversation.source, 'source'),
    key: requireNonEmptyString(conversation.conversationKey, 'conversationKey'),
    title: nullableMetadataString(conversation.title),
    url: nullableMetadataString(conversation.url),
    capturedAt: normalizeCapturedAt(conversation.lastCapturedAt),
    warnings: normalizeWarnings(conversation.warningFlags),
  };
}

async function buildJsonItem(input: {
  conversation: Conversation;
  messages: ConversationMessage[];
  basename: string;
  nextAttachmentIndex: () => number;
}): Promise<{ item: JsonExportItem; zipAttachments: MaterializedExportAttachment[] }> {
  const definition = conversationKinds.pick(input.conversation);
  const kindId = definition?.id;

  if (kindId === CHAT_KIND_ID) {
    const rawMessages = input.messages.map((message) => ({
      key: requireNonEmptyString(message.messageKey, 'messageKey'),
      role: nullableMetadataString(message.role) || 'assistant',
      author: nullableMetadataString(message.authorName),
      content: normalizeContent(message),
    }));
    const materialized = await materializeContentMarkdown({
      conversationId: input.conversation.id,
      basename: input.basename,
      contents: rawMessages.map((message) => message.content),
      nextAttachmentIndex: input.nextAttachmentIndex,
    });
    return {
      item: {
        ...commonFields(input.conversation, 'chat'),
        attachments: materialized.attachments,
        messages: rawMessages.map((message, index) => ({ ...message, content: materialized.contents[index]! })),
      },
      zipAttachments: materialized.zipAttachments,
    };
  }

  if (kindId === ARTICLE_KIND_ID) {
    const sourceMessage = findSemanticMessage(input.messages, 'article_body');
    const materialized = await materializeContentMarkdown({
      conversationId: input.conversation.id,
      basename: input.basename,
      contents: [normalizeContent(sourceMessage)],
      nextAttachmentIndex: input.nextAttachmentIndex,
    });
    return {
      item: {
        ...commonFields(input.conversation, 'article'),
        attachments: materialized.attachments,
        author: nullableMetadataString(input.conversation.author),
        publishedAt: nullableMetadataString(input.conversation.publishedAt),
        content: materialized.contents[0]!,
      },
      zipAttachments: materialized.zipAttachments,
    };
  }

  if (kindId === VIDEO_KIND_ID) {
    const sourceMessage = findSemanticMessage(input.messages, 'video_transcript');
    const materialized = await materializeContentMarkdown({
      conversationId: input.conversation.id,
      basename: input.basename,
      contents: [normalizeContent(sourceMessage)],
      nextAttachmentIndex: input.nextAttachmentIndex,
    });
    return {
      item: {
        ...commonFields(input.conversation, 'video'),
        attachments: materialized.attachments,
        author: nullableMetadataString(input.conversation.author),
        transcript: materialized.contents[0]!,
      },
      zipAttachments: materialized.zipAttachments,
    };
  }

  throw new Error(`Unsupported conversation kind: ${String(kindId || 'unknown')}`);
}

export async function buildConversationsJsonZipExport({
  conversations,
}: {
  conversations: Conversation[];
}): Promise<{ zipBlob: Blob; filename: string }> {
  if (!conversations.length) throw new Error('No conversations selected');

  const files: Array<{ name: string; data: string | Blob }> = [];
  const usedBasenames = new Set<string>();
  let attachmentIndex = 0;
  const nextAttachmentIndex = () => ++attachmentIndex;

  for (const conversation of conversations) {
    const conversationId = conversation.id;
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('Invalid conversation id');
    const detail = await getConversationDetail(conversationId);
    if (detail.conversationId !== conversationId) throw new Error('conversation detail returned a mismatched id');
    const basename = claimUniqueConversationExportBasename(conversation, usedBasenames);
    const built = await buildJsonItem({ conversation, messages: detail.messages, basename, nextAttachmentIndex });
    files.push({ name: `${basename}.json`, data: JSON.stringify(built.item, null, 2) });
    files.push(...built.zipAttachments.map(({ path, blob }) => ({ name: path, data: blob })));
  }

  return {
    zipBlob: await createZipBlob(files),
    filename: `SyncNos-json-${buildLocalTimestampForFilename()}.zip`,
  };
}

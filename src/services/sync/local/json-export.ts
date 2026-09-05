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
  markdown: string | null;
  text: string | null;
};

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

function contentString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
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
  return {
    markdown: contentString((message as any)?.contentMarkdown),
    text: contentString((message as any)?.contentText),
  };
}

function findSemanticMessage(messages: ConversationMessage[], messageKey: string): ConversationMessage | null {
  const semantic = messages.find((message) => (message as any)?.messageKey === messageKey);
  return semantic || messages[0] || null;
}

function toPublicAttachments(attachments: MaterializedExportAttachment[]): JsonAttachment[] {
  return attachments.map(({ path, mediaType, byteSize }) => ({ path, mediaType, byteSize }));
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
  const slotIndexes: number[] = [];
  const markdown: string[] = [];
  input.contents.forEach((content, index) => {
    if (content.markdown == null) return;
    slotIndexes.push(index);
    markdown.push(content.markdown);
  });

  const materialized = await materializeConversationMarkdownAssets({
    conversationId: input.conversationId,
    basename: input.basename,
    markdown,
    nextAttachmentIndex: input.nextAttachmentIndex,
  });
  const contents = input.contents.map((content) => ({ ...content }));
  slotIndexes.forEach((contentIndex, slotIndex) => {
    contents[contentIndex]!.markdown = materialized.markdown[slotIndex] ?? contents[contentIndex]!.markdown;
  });

  return {
    contents,
    attachments: toPublicAttachments(materialized.attachments),
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
    source: requireNonEmptyString((conversation as any)?.source, 'source'),
    key: requireNonEmptyString((conversation as any)?.conversationKey, 'conversationKey'),
    title: nullableMetadataString((conversation as any)?.title),
    url: nullableMetadataString((conversation as any)?.url),
    capturedAt: normalizeCapturedAt((conversation as any)?.lastCapturedAt),
    warnings: normalizeWarnings((conversation as any)?.warningFlags),
  };
}

async function buildJsonItem(input: {
  conversation: Conversation;
  conversationId: number;
  messages: ConversationMessage[];
  basename: string;
  nextAttachmentIndex: () => number;
}): Promise<{ item: JsonExportItem; zipAttachments: MaterializedExportAttachment[] }> {
  const definition = conversationKinds.pick(input.conversation as any);
  const kindId = definition?.id;

  if (kindId === CHAT_KIND_ID) {
    const rawMessages = input.messages.map((message) => ({
      key: requireNonEmptyString((message as any)?.messageKey, 'messageKey'),
      role: nullableMetadataString((message as any)?.role) || 'assistant',
      author: nullableMetadataString((message as any)?.authorName),
      content: normalizeContent(message),
    }));
    const materialized = await materializeContentMarkdown({
      conversationId: input.conversationId,
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
      conversationId: input.conversationId,
      basename: input.basename,
      contents: [normalizeContent(sourceMessage)],
      nextAttachmentIndex: input.nextAttachmentIndex,
    });
    return {
      item: {
        ...commonFields(input.conversation, 'article'),
        attachments: materialized.attachments,
        author: nullableMetadataString((input.conversation as any)?.author),
        publishedAt: nullableMetadataString((input.conversation as any)?.publishedAt),
        content: materialized.contents[0]!,
      },
      zipAttachments: materialized.zipAttachments,
    };
  }

  if (kindId === VIDEO_KIND_ID) {
    const sourceMessage = findSemanticMessage(input.messages, 'video_transcript');
    const materialized = await materializeContentMarkdown({
      conversationId: input.conversationId,
      basename: input.basename,
      contents: [normalizeContent(sourceMessage)],
      nextAttachmentIndex: input.nextAttachmentIndex,
    });
    return {
      item: {
        ...commonFields(input.conversation, 'video'),
        attachments: materialized.attachments,
        author: nullableMetadataString((input.conversation as any)?.author),
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
  const list = Array.isArray(conversations) ? conversations : [];
  if (!list.length) throw new Error('No conversations selected');

  for (const conversation of list) {
    const id = (conversation as any)?.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid conversation id');
    requireNonEmptyString((conversation as any)?.source, 'source');
    requireNonEmptyString((conversation as any)?.conversationKey, 'conversationKey');
  }

  const files: Array<{ name: string; data: string | Blob }> = [];
  const jsonFiles: Array<{ name: string; data: string }> = [];
  const usedBasenames = new Set<string>();
  let attachmentIndex = 0;
  const nextAttachmentIndex = () => {
    attachmentIndex += 1;
    return attachmentIndex;
  };

  for (const conversation of list) {
    const conversationId = conversation.id;
    const detail = await getConversationDetail(conversationId);
    if (detail?.conversationId !== conversationId) throw new Error('conversation detail returned a mismatched id');
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    const basename = claimUniqueConversationExportBasename(conversation, usedBasenames);
    const built = await buildJsonItem({ conversation, conversationId, messages, basename, nextAttachmentIndex });
    jsonFiles.push({ name: `${basename}.json`, data: JSON.stringify(built.item, null, 2) });
    files.push(...built.zipAttachments.map(({ path, blob }) => ({ name: path, data: blob })));
  }

  files.unshift(...jsonFiles);
  return {
    zipBlob: await createZipBlob(files),
    filename: `SyncNos-json-${buildLocalTimestampForFilename()}.zip`,
  };
}

import { getConversationDetail } from '@services/conversations/client/repo';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import type { Conversation } from '@services/conversations/domain/models';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import {
  claimUniqueConversationExportBasename,
  materializeConversationMarkdownAssets,
} from '@services/sync/local/export-shared';

export async function buildConversationsMarkdownZipExport({
  conversations,
}: {
  conversations: Conversation[];
}): Promise<{ zipBlob: Blob; filename: string }> {
  if (!conversations.length) throw new Error('No conversations selected');

  const files: Array<{ name: string; data: string | Blob }> = [];
  let attachmentIndex = 0;
  const nextAttachmentIndex = () => ++attachmentIndex;
  const usedBasenames = new Set<string>();

  for (const conversation of conversations) {
    const conversationId = conversation.id;
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('Invalid conversation id');
    const detail = await getConversationDetail(conversationId);
    if (detail.conversationId !== conversationId) throw new Error('conversation detail returned a mismatched id');
    const basename = claimUniqueConversationExportBasename(conversation, usedBasenames);
    const result = await materializeConversationMarkdownAssets({
      conversationId,
      basename,
      markdown: [formatConversationMarkdown(conversation, detail.messages)],
      nextAttachmentIndex,
    });
    files.push({ name: `${basename}.md`, data: result.markdown[0] });
    files.push(...result.attachments.map(({ path, blob }) => ({ name: path, data: blob })));
  }

  return {
    zipBlob: await createZipBlob(files),
    filename: `SyncNos-md-${buildLocalTimestampForFilename()}.zip`,
  };
}

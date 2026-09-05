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
  const list = (Array.isArray(conversations) ? conversations : []).filter((conversation) => {
    const id = Number(conversation?.id);
    return Number.isSafeInteger(id) && id > 0;
  });
  if (!list.length) throw new Error('No conversations selected');

  const stamp = buildLocalTimestampForFilename();
  const files: Array<{ name: string; data: string | Blob }> = [];
  let attachmentIndex = 0;
  const nextAttachmentIndex = () => {
    attachmentIndex += 1;
    return attachmentIndex;
  };
  const markdownFiles: Array<{ name: string; data: string }> = [];
  const usedBasenames = new Set<string>();

  for (const conversation of list) {
    const conversationId = Number(conversation.id);
    const detail = await getConversationDetail(conversationId);
    if (Number(detail?.conversationId) !== conversationId)
      throw new Error('conversation detail returned a mismatched id');
    const basename = claimUniqueConversationExportBasename(conversation, usedBasenames);
    const result = await materializeConversationMarkdownAssets({
      conversationId,
      basename,
      markdown: [formatConversationMarkdown(conversation, detail.messages || [])],
      nextAttachmentIndex,
    });
    markdownFiles.push({ name: `${basename}.md`, data: result.markdown[0] || '' });
    files.push(...result.attachments.map(({ path, blob }) => ({ name: path, data: blob })));
  }

  files.unshift(...markdownFiles);

  return {
    zipBlob: await createZipBlob(files),
    filename: `SyncNos-md-${stamp}.zip`,
  };
}

import { createZipBlob } from '@services/sync/backup/zip-utils';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import type { Conversation, ConversationFactsReference } from '@services/conversations/domain/models';
import { getConversationDetail } from '@services/conversations/client/repo';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import type { FactsEpoch } from '@services/local-data/contracts';

function toConversationFactsReference(conversation: Conversation): ConversationFactsReference {
  const source = String(conversation?.source || '').trim();
  const conversationKey = String(conversation?.conversationKey || '').trim();
  const factsEpoch = String(conversation?.factsEpoch || '').trim();
  if (!source || !conversationKey || !factsEpoch) throw new Error('stale conversation reference');
  return {
    source,
    conversationKey,
    factsEpoch: factsEpoch as FactsEpoch,
    ...(Number.isFinite(Number(conversation.id)) && Number(conversation.id) > 0
      ? { conversationId: Number(conversation.id) }
      : {}),
  };
}

export async function buildConversationsMarkdownZipExport({
  conversations,
  mergeSingle,
}: {
  conversations: Conversation[];
  mergeSingle: boolean;
}): Promise<{ zipBlob: Blob; filename: string }> {
  const list = Array.isArray(conversations) ? conversations : [];
  const ids = list.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) throw new Error('No conversations selected');

  const stamp = buildLocalTimestampForFilename();
  const files: Array<{ name: string; data: string }> = [];

  if (mergeSingle) {
    const docs: string[] = [];
    for (const c of list) {
      const d = await getConversationDetail(toConversationFactsReference(c));
      docs.push(formatConversationMarkdown(c, d.messages || []));
    }
    const text = docs.join('\n---\n\n');
    files.push({ name: `SyncNos-md-${stamp}.md`, data: text });
  } else {
    for (const c of list) {
      const d = await getConversationDetail(toConversationFactsReference(c));
      files.push({
        name: `${buildConversationBasename(c)}.md`,
        data: formatConversationMarkdown(c, d.messages || []),
      });
    }
  }

  const zipBlob = await createZipBlob(files);
  return { zipBlob, filename: `SyncNos-md-${stamp}.zip` };
}

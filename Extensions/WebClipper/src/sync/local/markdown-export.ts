import { createZipBlob } from '../backup/zip-utils';
import { buildConversationBasename } from '../../conversations/domain/file-naming';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import type { Conversation } from '../../conversations/domain/models';
import { getConversationDetail } from '../../conversations/client/repo';

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

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const files: Array<{ name: string; data: string }> = [];

  if (mergeSingle) {
    const docs: string[] = [];
    for (const c of list) {
      // eslint-disable-next-line no-await-in-loop
      const d = await getConversationDetail(Number(c.id));
      docs.push(formatConversationMarkdown(c, d.messages || []));
    }
    const text = docs.join('\n---\n\n');
    files.push({ name: `webclipper-export-${stamp}.md`, data: text });
  } else {
    for (const c of list) {
      // eslint-disable-next-line no-await-in-loop
      const d = await getConversationDetail(Number(c.id));
      files.push({
        name: `${buildConversationBasename(c)}.md`,
        data: formatConversationMarkdown(c, d.messages || []),
      });
    }
  }

  const zipBlob = await createZipBlob(files);
  return { zipBlob, filename: `webclipper-export-${stamp}.zip` };
}

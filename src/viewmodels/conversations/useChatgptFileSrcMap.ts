import { useEffect, useMemo, useState } from 'react';

import { resolveChatgptImageUrlsForConversation } from '@services/integrations/chatgpt/image-client';
import { chatgptFileIdFromUrl } from '@services/shared/chatgpt-image-identity';
import { collectMarkdownImageReferences } from '@services/shared/markdown-image-references';

const EMPTY_FILE_SRC_MAP: ReadonlyMap<string, string> = new Map();

function collectFileIds(markdowns: readonly string[]): string[] {
  const seen = new Set<string>();
  const fileIds: string[] = [];
  for (const markdown of markdowns) {
    for (const reference of collectMarkdownImageReferences(markdown)) {
      const fileId = chatgptFileIdFromUrl(reference.target);
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      fileIds.push(fileId);
    }
  }
  return fileIds;
}

export function useChatgptFileSrcMap(input: {
  conversationId?: number | null;
  markdowns: readonly string[];
}): ReadonlyMap<string, string> {
  const rawConversationId = Number(input.conversationId);
  const conversationId = Number.isSafeInteger(rawConversationId) && rawConversationId > 0 ? rawConversationId : null;
  const fileIdsKey = useMemo(
    () => collectFileIds(Array.isArray(input.markdowns) ? input.markdowns : []).join(','),
    [input.markdowns],
  );
  const [srcByFileId, setSrcByFileId] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const fileIds = fileIdsKey ? fileIdsKey.split(',') : [];
    if (!conversationId || !fileIds.length) {
      setSrcByFileId(new Map());
      return () => {
        cancelled = true;
      };
    }

    void resolveChatgptImageUrlsForConversation({ conversationId, fileIds })
      .then((resolved) => {
        if (!cancelled) setSrcByFileId(resolved);
      })
      .catch(() => {
        if (!cancelled) setSrcByFileId(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, fileIdsKey]);

  return conversationId && fileIdsKey ? srcByFileId : EMPTY_FILE_SRC_MAP;
}

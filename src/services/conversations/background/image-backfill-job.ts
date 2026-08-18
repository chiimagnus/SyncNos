import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import type { ImageStorage } from '@services/conversations/data/image-storage';
import type {
  ConversationFactsRepository,
  ConversationMessageSyncOptions,
  ResolvedConversationReference,
} from '@services/conversations/data/storage';
import { LocalDataContractError, parseExactMessageKey, type JsonValue } from '@services/local-data/contracts';

export type BackfillConversationImagesResult = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export type BackfillConversationImagesProgress = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
  latestMessageKey?: string;
};

/** Backfill receives already-bound facts capabilities; it never opens an IDB convenience path. */
export async function backfillConversationImages(input: {
  imageStorage: Pick<ImageStorage, 'findAssetByUrl' | 'putAsset'>;
  owner: ResolvedConversationReference;
  repository: Pick<ConversationFactsRepository, 'getConversationDetail' | 'syncConversationMessages'>;
  conversationUrl?: string;
  onProgress?: (progress: BackfillConversationImagesProgress) => Promise<void> | void;
}): Promise<BackfillConversationImagesResult> {
  const owner = input.owner;
  const conversationId = Number(owner?.conversationId);
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new LocalDataContractError('STALE_REFERENCE');

  const detail = await input.repository.getConversationDetail({
    source: owner.source,
    conversationKey: owner.conversationKey,
  });
  if (Number(detail.conversationId) !== conversationId) throw new LocalDataContractError('STALE_REFERENCE');
  const messages = Array.isArray(detail.messages) ? (detail.messages as any[]) : [];
  const beforeMarkdown = new Map<string, string>();
  for (const msg of messages) {
    const key = msg && (msg as any).messageKey ? String((msg as any).messageKey) : '';
    if (!key) continue;
    beforeMarkdown.set(key, String((msg as any).contentMarkdown || ''));
  }

  const progressCallback = typeof input.onProgress === 'function' ? input.onProgress : null;
  const persistedUpdatedKeys = new Set<string>();

  const inlined = await inlineChatImagesInMessages({
    imageStorage: input.imageStorage,
    owner,
    conversationUrl: input.conversationUrl,
    messages,
    onMessageUpdated: progressCallback
      ? async (update) => {
          const key = parseExactMessageKey(update?.messageKey);
          if (persistedUpdatedKeys.has(key)) return;
          const options: ConversationMessageSyncOptions = {
            mode: 'incremental',
            diff: { added: [], updated: [key], removed: [] },
          };
          await input.repository.syncConversationMessages(owner, [update.message] as JsonValue, options);
          persistedUpdatedKeys.add(key);

          await progressCallback({
            scannedMessages: messages.length,
            updatedMessages: persistedUpdatedKeys.size,
            inlinedCount: Number(update?.inlinedCount) || 0,
            fromCacheCount: Number(update?.fromCacheCount) || 0,
            downloadedCount: Number(update?.downloadedCount) || 0,
            inlinedBytes: Number(update?.inlinedBytes) || 0,
            warningFlags: Array.isArray(update?.warningFlags) ? update.warningFlags : [],
            latestMessageKey: key,
          });
        }
      : undefined,
  });

  const updatedKeys: string[] = [];
  for (const msg of inlined.messages) {
    const key = msg && msg.messageKey ? String(msg.messageKey) : '';
    if (!key) continue;
    const before = beforeMarkdown.get(key) ?? '';
    const after = String(msg.contentMarkdown || '');
    if (after && after !== before) updatedKeys.push(key);
  }

  if (updatedKeys.length && !progressCallback) {
    await input.repository.syncConversationMessages(owner, inlined.messages as JsonValue, {
      mode: 'incremental',
      diff: { added: [], updated: updatedKeys, removed: [] },
    });
  }

  return {
    scannedMessages: messages.length,
    updatedMessages: updatedKeys.length,
    inlinedCount: inlined.inlinedCount,
    fromCacheCount: inlined.fromCacheCount,
    downloadedCount: inlined.downloadedCount,
    inlinedBytes: inlined.inlinedBytes,
    warningFlags: inlined.warningFlags,
  };
}

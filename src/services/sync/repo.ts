import {
  FEISHU_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import type { ConversationFactsReference } from '@services/conversations/domain/models';
import type { FactsEpoch, StableConversationReference } from '@services/local-data/contracts';
import type { SyncJobStatusResponse, SyncProvider } from '@services/sync/models';

export type SyncStartAck = {
  provider: SyncProvider;
  started: boolean;
};

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  const error = new Error(message) as Error & { extra?: unknown };
  error.extra = res.error?.extra ?? null;
  throw error;
}

export async function getNotionSyncJobStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS);
  return unwrap(res);
}

export async function clearNotionSyncJobStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(NOTION_MESSAGE_TYPES.CLEAR_SYNC_JOB_STATUS);
  return unwrap(res);
}

export async function getObsidianSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

export async function clearObsidianSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(OBSIDIAN_MESSAGE_TYPES.CLEAR_SYNC_STATUS);
  return unwrap(res);
}

export async function getFeishuSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

export async function clearFeishuSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(FEISHU_MESSAGE_TYPES.CLEAR_SYNC_STATUS);
  return unwrap(res);
}

type SyncRequestBatch = Readonly<{
  factsEpoch: FactsEpoch;
  conversations: StableConversationReference[];
}>;

function normalizeSyncBatch(references: readonly ConversationFactsReference[]): SyncRequestBatch {
  if (!Array.isArray(references) || !references.length) throw new Error('No conversations selected');
  const factsEpoch = String(references[0]?.factsEpoch || '').trim();
  if (!factsEpoch) throw new Error('Missing facts epoch');
  const seen = new Set<string>();
  const conversations: StableConversationReference[] = [];
  for (const reference of references) {
    const source = String(reference?.source || '').trim();
    const conversationKey = String(reference?.conversationKey || '').trim();
    if (!source || !conversationKey || String(reference?.factsEpoch || '').trim() !== factsEpoch) {
      throw new Error('Stale conversation reference');
    }
    const key = `${source}\u0000${conversationKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conversations.push({ source, conversationKey });
  }
  if (!conversations.length) throw new Error('No conversations selected');
  return { factsEpoch: factsEpoch as FactsEpoch, conversations };
}

export async function syncNotionConversations(references: ConversationFactsReference[]): Promise<SyncStartAck> {
  const batch = normalizeSyncBatch(references);
  const res = await send<ApiResponse<SyncStartAck>>(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, batch);
  return unwrap(res);
}

export async function syncObsidianConversations(
  references: ConversationFactsReference[],
  { forceFullReferences = [] }: { forceFullReferences?: ConversationFactsReference[] } = {},
): Promise<SyncStartAck> {
  const batch = normalizeSyncBatch(references);
  const forceFull = forceFullReferences.length ? normalizeSyncBatch(forceFullReferences) : null;
  if (forceFull && forceFull.factsEpoch !== batch.factsEpoch) throw new Error('Stale conversation reference');
  const res = await send<ApiResponse<SyncStartAck>>(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, {
    ...batch,
    ...(forceFull ? { forceFullConversations: forceFull.conversations } : {}),
  });
  return unwrap(res);
}

export async function syncFeishuConversations(references: ConversationFactsReference[]): Promise<SyncStartAck> {
  const batch = normalizeSyncBatch(references);
  const res = await send<ApiResponse<SyncStartAck>>(FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, batch);
  return unwrap(res);
}

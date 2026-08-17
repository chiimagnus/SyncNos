import { CORE_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import {
  LOCAL_DATA_ERROR_CODES,
  LocalDataContractError,
  parseInsightFactsSnapshot,
  parseInsightStatsRequestPayload,
  type InsightFactsSnapshot,
  type InsightStatsRequestPayload,
  type LocalDataErrorCode,
} from '@services/local-data/contracts';

type ApiError = Readonly<{ message: string; extra: unknown }> | null;
type ApiResponse<T> = Readonly<{ ok: boolean; data: T | null; error: ApiError }>;

function unwrapInsightResponse(response: ApiResponse<unknown>): unknown {
  if (!response || typeof response.ok !== 'boolean') throw new LocalDataContractError('PROTOCOL_MISMATCH');
  if (response.ok) return response.data;
  const extra = response.error?.extra;
  const code = (extra as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && LOCAL_DATA_ERROR_CODES.includes(code as LocalDataErrorCode)) {
    throw new LocalDataContractError(code as LocalDataErrorCode);
  }
  throw new Error(response.error?.message ?? 'Insight facts read failed');
}

/** Reads only the bounded, backend-neutral aggregate needed by About You. */
export async function getInsightFactsSnapshot(input: InsightStatsRequestPayload): Promise<InsightFactsSnapshot> {
  const request = parseInsightStatsRequestPayload(input);
  const response = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.GET_INSIGHT_STATS, request);
  return parseInsightFactsSnapshot(unwrapInsightResponse(response));
}

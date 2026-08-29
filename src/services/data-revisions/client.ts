import { DATA_REVISION_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@platform/runtime/runtime';
import {
  DATA_REVISION_SCOPES,
  type DataRevisionScope,
  type DataRevisionSnapshot,
} from '@platform/idb/data-revision-record';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error?: { message?: unknown } | null;
};

function normalizeSnapshot(value: unknown): DataRevisionSnapshot {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!raw) throw new Error('invalid data revision snapshot');

  const snapshot = {} as DataRevisionSnapshot;
  for (const scope of DATA_REVISION_SCOPES) {
    const revision = Number(raw[scope]);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid data revision snapshot');
    snapshot[scope] = revision;
  }
  return snapshot;
}

export async function getDataRevisionSnapshot(): Promise<DataRevisionSnapshot> {
  const response = await send<ApiResponse<DataRevisionSnapshot>>(DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT);
  if (!response || response.ok !== true) {
    throw new Error(String(response?.error?.message || 'data revision snapshot unavailable'));
  }
  return normalizeSnapshot(response.data);
}

export { DATA_REVISION_SCOPES };
export type { DataRevisionScope, DataRevisionSnapshot };

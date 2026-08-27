import { hasAsciiControlCharacter } from '@platform/validation/ascii-control';

export const GITHUB_CLEANUP_OUTBOX_STORE = 'github_cleanup_outbox' as const;
export const GITHUB_CLEANUP_OUTBOX_DUE_INDEX = 'by_remoteKey_nextAttemptAt_createdAt' as const;

export type GithubCleanupOutboxReason = 'delete' | 'identity_move';

export type GithubCleanupOutboxRecord = {
  id?: number;
  remoteKey: string;
  paths: string[];
  reason: GithubCleanupOutboxReason;
  replacementConversationId?: number;
  createdAt: number;
  nextAttemptAt: number;
};

function normalizeRemoteKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null;
  if (hasAsciiControlCharacter(value)) return null;
  return value;
}

function normalizeFiniteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function isSafeGithubCleanupPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false;
  if (value.startsWith('/') || value.includes('\\') || hasAsciiControlCharacter(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  const lower = value.toLowerCase();
  return lower !== '.github/workflows' && !lower.startsWith('.github/workflows/');
}

function normalizePaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((path) => !isSafeGithubCleanupPath(path))) return null;
  const paths = [...new Set(value)].sort();
  return paths.length > 0 ? paths : null;
}

export function normalizeGithubCleanupOutboxRecord(value: unknown): GithubCleanupOutboxRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const remoteKey = normalizeRemoteKey(raw.remoteKey);
  const paths = normalizePaths(raw.paths);
  const reason = raw.reason === 'delete' || raw.reason === 'identity_move' ? raw.reason : null;
  const createdAt = normalizeFiniteTimestamp(raw.createdAt);
  const nextAttemptAt = normalizeFiniteTimestamp(raw.nextAttemptAt);
  if (!remoteKey || !paths || !reason || createdAt == null || nextAttemptAt == null) return null;

  const id = raw.id == null ? null : normalizePositiveInt(raw.id);
  if (raw.id != null && id == null) return null;
  const replacementConversationId =
    raw.replacementConversationId == null ? null : normalizePositiveInt(raw.replacementConversationId);
  if (raw.replacementConversationId != null && replacementConversationId == null) return null;
  if (reason === 'identity_move' && replacementConversationId == null) return null;
  if (reason === 'delete' && raw.replacementConversationId != null) return null;

  return {
    ...(id == null ? {} : { id }),
    remoteKey,
    paths,
    reason,
    ...(replacementConversationId == null ? {} : { replacementConversationId }),
    createdAt,
    nextAttemptAt,
  };
}

export function buildGithubCleanupOutboxRecord(input: {
  remoteKey: string;
  paths: string[];
  reason: GithubCleanupOutboxReason;
  replacementConversationId?: number;
  createdAt: number;
}): GithubCleanupOutboxRecord {
  const normalized = normalizeGithubCleanupOutboxRecord({
    ...input,
    nextAttemptAt: input.createdAt,
  });
  if (!normalized) throw new Error('github_cleanup_outbox_invalid');
  return normalized;
}

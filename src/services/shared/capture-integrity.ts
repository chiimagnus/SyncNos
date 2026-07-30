export type CaptureCompleteness = 'complete' | 'partial';

export type CaptureMeta = {
  completeness: CaptureCompleteness;
  identityVerified: boolean;
  reasons?: string[];
  metrics?: Record<string, number | boolean>;
};

export type CaptureMessageMergePolicy = 'replace' | 'preserve-existing-markdown' | 'preserve-existing-content';

export type CaptureMessageTransientFields = {
  captureSequencePolicy?: 'preserve-existing-tail';
  captureMergePolicy?: CaptureMessageMergePolicy;
};

export type CapturePersistencePlan = {
  mode: 'snapshot' | 'append';
  diff: { added: string[]; updated: string[]; removed: string[] } | null;
};

export type CaptureIntegritySuccess = {
  ok: true;
  snapshot: any;
  meta: CaptureMeta | null;
  persistence: CapturePersistencePlan;
};

export type CaptureIntegrityFailure = {
  ok: false;
  code: 'capture_integrity_unverified' | 'capture_integrity_no_safe_messages';
  meta: CaptureMeta;
};

export type CaptureIntegrityResult = CaptureIntegritySuccess | CaptureIntegrityFailure;

export const VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS = new Set<string>(['chatgpt', 'googleaistudio']);

function stableString(value: unknown): string {
  return String(value || '').trim();
}

function stableIdentityString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeStrings(values: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = stableString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeMetrics(value: unknown): Record<string, number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const metrics: Record<string, number | boolean> = {};
  for (const [key, metric] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = stableString(key);
    if (!normalizedKey || (typeof metric !== 'number' && typeof metric !== 'boolean')) continue;
    if (typeof metric === 'number' && !Number.isFinite(metric)) continue;
    metrics[normalizedKey] = metric;
  }
  return Object.keys(metrics).length ? metrics : undefined;
}

function normalizeMeta(raw: unknown): CaptureMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.completeness !== 'complete' && input.completeness !== 'partial') return null;
  if (typeof input.identityVerified !== 'boolean') return null;
  const reasons = dedupeStrings(input.reasons);
  const metrics = normalizeMetrics(input.metrics);
  return {
    completeness: input.completeness,
    identityVerified: input.identityVerified,
    ...(reasons.length ? { reasons } : null),
    ...(metrics ? { metrics } : null),
  };
}

function normalizedMergePolicy(value: unknown): CaptureMessageMergePolicy {
  return value === 'preserve-existing-markdown' || value === 'preserve-existing-content' ? value : 'replace';
}

function isStablePartialKey(value: unknown): value is string {
  const key = stableIdentityString(value);
  return !!key && !key.toLowerCase().startsWith('fallback_');
}

function failureMeta(meta: CaptureMeta | null, reason: string): CaptureMeta {
  return {
    completeness: 'partial',
    identityVerified: meta?.identityVerified === true,
    reasons: dedupeStrings([...(meta?.reasons || []), reason]),
    ...(meta?.metrics ? { metrics: meta.metrics } : null),
  };
}

export function resolveCaptureIntegrity(collectorId: unknown, snapshot: any): CaptureIntegrityResult {
  const normalizedCollectorId = stableIdentityString(collectorId).toLowerCase();
  const isVirtual = VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS.has(normalizedCollectorId);
  const meta = normalizeMeta(snapshot?.captureMeta);
  const rawMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const hasProtectivePolicy = rawMessages.some(
    (message: any) => normalizedMergePolicy(message?.captureMergePolicy) !== 'replace',
  );

  if (isVirtual) {
    const source = stableIdentityString(snapshot?.conversation?.source).toLowerCase();
    const conversationKey = stableIdentityString(snapshot?.conversation?.conversationKey);
    if (!meta || meta.identityVerified !== true || source !== normalizedCollectorId || !conversationKey) {
      return {
        ok: false,
        code: 'capture_integrity_unverified',
        meta: failureMeta(meta, 'capture_integrity_unverified'),
      };
    }
  }

  if (!meta && !isVirtual && !hasProtectivePolicy) {
    return {
      ok: true,
      snapshot,
      meta: null,
      persistence: { mode: 'snapshot', diff: null },
    };
  }

  let effectiveMeta: CaptureMeta = meta || {
    completeness: 'partial',
    identityVerified: false,
    reasons: ['protective_message_merge'],
  };
  const completeKeys: string[] = rawMessages.map((message: any) => stableIdentityString(message?.messageKey));
  const completeKeysAreSafe =
    rawMessages.length > 0 &&
    completeKeys.every((key) => isStablePartialKey(key)) &&
    new Set(completeKeys).size === completeKeys.length;
  const unsafeComplete =
    isVirtual &&
    effectiveMeta.completeness === 'complete' &&
    (!completeKeysAreSafe || (effectiveMeta.reasons || []).length > 0);
  if (unsafeComplete) {
    effectiveMeta = failureMeta(effectiveMeta, 'capture_integrity_complete_untrusted');
  }
  const forcePartial = effectiveMeta.completeness === 'partial' || hasProtectivePolicy || unsafeComplete;

  if (!forcePartial) {
    return {
      ok: true,
      snapshot: { ...snapshot, captureMeta: effectiveMeta },
      meta: effectiveMeta,
      persistence: { mode: 'snapshot', diff: null },
    };
  }

  const firstPositions: string[] = [];
  const byKey = new Map<string, any>();
  for (const message of rawMessages) {
    const key = stableIdentityString(message?.messageKey);
    if (!isStablePartialKey(key)) continue;
    if (!byKey.has(key)) firstPositions.push(key);
    byKey.set(key, {
      ...message,
      messageKey: key,
      captureSequencePolicy: 'preserve-existing-tail',
      captureMergePolicy: normalizedMergePolicy(message?.captureMergePolicy),
    });
  }

  const messages = firstPositions.map((key) => byKey.get(key));
  if (!messages.length) {
    return {
      ok: false,
      code: 'capture_integrity_no_safe_messages',
      meta: failureMeta(effectiveMeta, 'capture_integrity_no_safe_messages'),
    };
  }

  const reasons = dedupeStrings([
    ...(effectiveMeta.reasons || []),
    ...(hasProtectivePolicy ? ['protective_message_merge'] : []),
  ]);
  const normalizedMeta: CaptureMeta = {
    ...effectiveMeta,
    completeness: 'partial',
    ...(reasons.length ? { reasons } : null),
  };
  const keys = messages.map((message: any) => message.messageKey);
  return {
    ok: true,
    snapshot: { ...snapshot, messages, captureMeta: normalizedMeta },
    meta: normalizedMeta,
    persistence: {
      mode: 'append',
      diff: { added: keys, updated: [], removed: [] },
    },
  };
}

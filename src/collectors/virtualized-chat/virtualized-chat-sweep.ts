export type ScrollMetrics = {
  top: number;
  left: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
};

export type ScrollRestoreResult = {
  restored: boolean;
  reason: 'restored' | 'missing_identity' | 'identity_changed' | 'root_detached' | 'root_replaced' | 'restore_failed';
};

type ScrollRuntime = {
  document: Document;
  window: Window & typeof globalThis;
  getSeed: () => Element | null;
  sampleIdentity: () => string | null;
};

type ScrollRootSnapshot = {
  root: Element;
  isDocumentRoot: boolean;
  identity: string;
  metrics: ScrollMetrics;
  wasAtBottom: boolean;
};

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function documentScrollRoot(document: Document): Element {
  return document.scrollingElement || document.documentElement;
}

function isDocumentScrollRoot(document: Document, root: Element): boolean {
  return root === document.scrollingElement || root === document.documentElement || root === document.body;
}

function permitsVerticalScroll(window: Window & typeof globalThis, element: Element): boolean {
  try {
    const style = window.getComputedStyle(element);
    const overflowY = String(style?.overflowY || style?.overflow || '').toLowerCase();
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  } catch (_error) {
    return false;
  }
}

export function resolveScrollRoot(runtime: Pick<ScrollRuntime, 'document' | 'window'>, seed: Element | null): Element {
  let current: Element | null = seed;
  while (current) {
    if (
      permitsVerticalScroll(runtime.window, current) &&
      finite((current as HTMLElement).scrollHeight) > finite((current as HTMLElement).clientHeight)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return documentScrollRoot(runtime.document);
}

function usesReverseVerticalScroll(runtime: Pick<ScrollRuntime, 'document' | 'window'>, root: Element): boolean {
  if (isDocumentScrollRoot(runtime.document, root)) return false;
  try {
    return String(runtime.window.getComputedStyle(root).flexDirection || '').toLowerCase() === 'column-reverse';
  } catch (_error) {
    return false;
  }
}

export function readScrollMetrics(runtime: Pick<ScrollRuntime, 'document' | 'window'>, root: Element): ScrollMetrics {
  const isDocument = isDocumentScrollRoot(runtime.document, root);
  const element = root as HTMLElement;
  const scrollHeight = finite(element.scrollHeight);
  const clientHeight = finite(element.clientHeight);
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  const physicalTop = isDocument
    ? finite(runtime.window.scrollY, finite(element.scrollTop))
    : finite(element.scrollTop);
  const top = usesReverseVerticalScroll(runtime, root)
    ? clamp(maxTop + physicalTop, 0, maxTop)
    : clamp(physicalTop, 0, maxTop);
  return {
    top,
    left: isDocument ? finite(runtime.window.scrollX, finite(element.scrollLeft)) : finite(element.scrollLeft),
    scrollHeight,
    scrollWidth: finite(element.scrollWidth),
    clientHeight,
    clientWidth: finite(element.clientWidth),
  };
}

export function writeScrollPosition(
  runtime: Pick<ScrollRuntime, 'document' | 'window'>,
  root: Element,
  left: number,
  top: number,
): void {
  const metrics = readScrollMetrics(runtime, root);
  const nextLeft = clamp(finite(left), 0, metrics.scrollWidth - metrics.clientWidth);
  const maxTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const nextTop = clamp(finite(top), 0, maxTop);
  if (isDocumentScrollRoot(runtime.document, root)) {
    runtime.window.scrollTo(nextLeft, nextTop);
    return;
  }
  const element = root as HTMLElement;
  element.scrollLeft = nextLeft;
  element.scrollTop = usesReverseVerticalScroll(runtime, root) ? nextTop - maxTop : nextTop;
}

export function isAtScrollTop(metrics: ScrollMetrics): boolean {
  return metrics.top <= 1;
}

export function isAtScrollBottom(metrics: ScrollMetrics): boolean {
  return metrics.top + metrics.clientHeight >= metrics.scrollHeight - 1;
}

export function createScrollRootRestorer(runtime: ScrollRuntime): { restore: () => ScrollRestoreResult } {
  const identity = String(runtime.sampleIdentity() || '').trim();
  const root = resolveScrollRoot(runtime, runtime.getSeed());
  const metrics = readScrollMetrics(runtime, root);
  const snapshot: ScrollRootSnapshot = {
    root,
    isDocumentRoot: isDocumentScrollRoot(runtime.document, root),
    identity,
    metrics,
    wasAtBottom: isAtScrollBottom(metrics),
  };
  let restored = false;

  return {
    restore(): ScrollRestoreResult {
      if (restored) return { restored: false, reason: 'restore_failed' };
      restored = true;
      if (!snapshot.identity) return { restored: false, reason: 'missing_identity' };
      if (String(runtime.sampleIdentity() || '').trim() !== snapshot.identity) {
        return { restored: false, reason: 'identity_changed' };
      }
      if (!snapshot.isDocumentRoot && !snapshot.root.isConnected) {
        return { restored: false, reason: 'root_detached' };
      }
      const currentRoot = resolveScrollRoot(runtime, runtime.getSeed());
      if (currentRoot !== snapshot.root) return { restored: false, reason: 'root_replaced' };
      try {
        const currentMetrics = readScrollMetrics(runtime, snapshot.root);
        const restoreTop = snapshot.wasAtBottom
          ? Math.max(0, currentMetrics.scrollHeight - currentMetrics.clientHeight)
          : snapshot.metrics.top;
        writeScrollPosition(runtime, snapshot.root, snapshot.metrics.left, restoreTop);
        return { restored: true, reason: 'restored' };
      } catch (_error) {
        return { restored: false, reason: 'restore_failed' };
      }
    },
  };
}

export type PreparedMessageRecord<T> = {
  key: string;
  turnKey: string;
  withinTurn: number;
  fingerprint: string;
  payload: T;
};

export type PreparedIdentityGuard = {
  route: string;
  durableId: string;
  anchors: string[];
  topAnchor: string;
};

export type PreparedAccumulator<T> = {
  source: string;
  conversationKey: string;
  identityVerified: boolean;
  identityGuard: PreparedIdentityGuard;
  records: PreparedMessageRecord<T>[];
  reasons: string[];
  completeness: 'complete' | 'partial';
  sweepMetrics: Record<string, number | boolean>;
};

export type VirtualizedPreparedCapture<T> = {
  kind: 'syncnos.virtualized-chat.prepared.v1';
  source: string;
  conversationKey: string;
  identityVerified: boolean;
  identityGuard: PreparedIdentityGuard;
  records: PreparedMessageRecord<T>[];
  reasons: string[];
  completeness: 'complete' | 'partial';
  metrics: Record<string, number | boolean>;
};

export function createPreparedAccumulator<T>(input: {
  source: string;
  conversationKey: string;
  identityVerified: boolean;
  identityGuard?: Partial<PreparedIdentityGuard>;
}): PreparedAccumulator<T> {
  return {
    source: String(input.source || '').trim(),
    conversationKey: String(input.conversationKey || '').trim(),
    identityVerified: input.identityVerified === true,
    identityGuard: {
      route: String(input.identityGuard?.route || ''),
      durableId: String(input.identityGuard?.durableId || ''),
      anchors: Array.isArray(input.identityGuard?.anchors)
        ? input.identityGuard.anchors.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      topAnchor: String(input.identityGuard?.topAnchor || ''),
    },
    records: [],
    reasons: [],
    completeness: 'partial',
    sweepMetrics: {},
  };
}

const VIRTUALIZED_REASON_CODES = new Set([
  'invalid_reason',
  'missing_identity',
  'unstable_identity',
  'identity_changed',
  'root_detached',
  'root_replaced',
  'restore_failed',
  'order_unanchored',
  'order_conflict',
  'step_timeout',
  'step_budget_exhausted',
  'total_deadline_exhausted',
  'unresolved_turn',
  'pass_failed',
  'extraction_error',
  'scroll_stalled',
  'top_not_reached',
  'bottom_not_reached',
  'boundary_stalled',
  'boundary_unstable',
  'final_live_changed',
]);

export function addPreparedReason<T>(accumulator: PreparedAccumulator<T>, reason: string): void {
  const requested = String(reason || '').trim();
  if (!requested) return;
  const normalized = VIRTUALIZED_REASON_CODES.has(requested) ? requested : 'invalid_reason';
  if (!accumulator.reasons.includes(normalized)) accumulator.reasons.push(normalized);
}

export function mergePreparedRecords<T>(
  accumulator: PreparedAccumulator<T>,
  records: PreparedMessageRecord<T>[],
  options: { newestFirst?: boolean } = {},
): { added: number; updated: number } {
  const incoming = records
    .map((record) => ({ ...record, key: String(record?.key || '').trim() }))
    .filter((record) => !!record.key);
  if (!incoming.length) return { added: 0, updated: 0 };

  const uniqueIncoming: typeof incoming = [];
  const incomingKeys = new Set<string>();
  for (const record of incoming) {
    if (incomingKeys.has(record.key)) continue;
    incomingKeys.add(record.key);
    uniqueIncoming.push(record);
  }

  accumulator.records = accumulator.records.slice();
  let updated = 0;
  const positions = new Map(accumulator.records.map((record, index) => [record.key, index]));
  for (const record of uniqueIncoming) {
    const index = positions.get(record.key);
    if (index === undefined) continue;
    const existing = accumulator.records[index];
    if (existing.fingerprint === record.fingerprint) continue;
    accumulator.records[index] = record;
    updated += 1;
  }

  if (!accumulator.records.length) {
    accumulator.records.push(...uniqueIncoming);
    return { added: uniqueIncoming.length, updated };
  }

  const knownIncoming = uniqueIncoming.filter((record) => positions.has(record.key));
  if (!knownIncoming.length) {
    addPreparedReason(accumulator, 'order_unanchored');
    if (options.newestFirst) accumulator.records.unshift(...uniqueIncoming);
    else accumulator.records.push(...uniqueIncoming);
    return { added: uniqueIncoming.length, updated };
  }

  const knownPositions = knownIncoming.map((record) => positions.get(record.key) as number);
  if (knownPositions.some((position, index) => index > 0 && position <= knownPositions[index - 1])) {
    addPreparedReason(accumulator, 'order_conflict');
    return { added: 0, updated };
  }

  let added = 0;
  let cursor = 0;
  while (cursor < uniqueIncoming.length) {
    if (positions.has(uniqueIncoming[cursor].key)) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < uniqueIncoming.length && !positions.has(uniqueIncoming[cursor].key)) cursor += 1;
    const unknownRun = uniqueIncoming.slice(start, cursor);
    const previousKnown = start > 0 ? uniqueIncoming[start - 1].key : '';
    const nextKnown = cursor < uniqueIncoming.length ? uniqueIncoming[cursor].key : '';

    let insertionIndex = accumulator.records.length;
    if (nextKnown) {
      insertionIndex = accumulator.records.findIndex((record) => record.key === nextKnown);
    } else if (previousKnown) {
      const previousIndex = accumulator.records.findIndex((record) => record.key === previousKnown);
      insertionIndex = previousIndex < 0 ? accumulator.records.length : previousIndex + 1;
    }

    accumulator.records.splice(insertionIndex, 0, ...unknownRun);
    added += unknownRun.length;
  }

  return { added, updated };
}

export function finishPreparedCapture<T>(accumulator: PreparedAccumulator<T>): VirtualizedPreparedCapture<T> {
  return {
    kind: 'syncnos.virtualized-chat.prepared.v1',
    source: accumulator.source,
    conversationKey: accumulator.conversationKey,
    identityVerified: accumulator.identityVerified,
    identityGuard: {
      ...accumulator.identityGuard,
      anchors: accumulator.identityGuard.anchors.slice(),
    },
    records: accumulator.records.slice(),
    reasons: accumulator.reasons.slice(),
    completeness: accumulator.completeness,
    metrics: { ...accumulator.sweepMetrics },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPreparedIdentityGuard(value: unknown): value is PreparedIdentityGuard {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.route === 'string' &&
    typeof value.durableId === 'string' &&
    typeof value.topAnchor === 'string' &&
    Array.isArray(value.anchors) &&
    value.anchors.every((anchor) => typeof anchor === 'string')
  );
}

function isPreparedRecord<T>(value: unknown): value is PreparedMessageRecord<T> {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    !!value.key.trim() &&
    typeof value.turnKey === 'string' &&
    !!value.turnKey.trim() &&
    Number.isInteger(value.withinTurn) &&
    Number(value.withinTurn) >= 0 &&
    typeof value.fingerprint === 'string' &&
    'payload' in value
  );
}

function isPreparedMetrics(value: unknown): value is VirtualizedPreparedCapture<unknown>['metrics'] {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(
    (metric) => typeof metric === 'boolean' || (typeof metric === 'number' && Number.isFinite(metric)),
  );
}

export function readPreparedCapture<T>(value: unknown, source: string): VirtualizedPreparedCapture<T> | null {
  if (!isPlainRecord(value)) return null;
  if (value.kind !== 'syncnos.virtualized-chat.prepared.v1' || value.source !== source) return null;
  if (typeof value.conversationKey !== 'string' || typeof value.identityVerified !== 'boolean') return null;
  if (value.identityVerified && !value.conversationKey.trim()) return null;
  if (!isPreparedIdentityGuard(value.identityGuard)) return null;
  if (!Array.isArray(value.records) || !value.records.every((record) => isPreparedRecord<T>(record))) return null;
  if (!Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === 'string')) return null;
  if (value.completeness !== 'complete' && value.completeness !== 'partial') return null;
  if (!isPreparedMetrics(value.metrics)) return null;
  return value as VirtualizedPreparedCapture<T>;
}

export function createPreparedCaptureConsumer<T>(source: string) {
  const consumed = new WeakSet<object>();
  return (value: unknown): VirtualizedPreparedCapture<T> | null => {
    const prepared = readPreparedCapture<T>(value, source);
    if (!prepared || !isPlainRecord(value) || consumed.has(value)) return null;
    consumed.add(value);
    return prepared;
  };
}

export type VirtualizedBoundary = 'top' | 'bottom';
export type VirtualizedBoundaryState = 'confirmed' | 'pending' | 'unverified';

export type VirtualizedPassAdapter<T> = {
  getScrollSeed: () => Element | null;
  sampleIdentity: () => string | null;
  readDescriptorKeys: () => string[];
  // Unresolved entries must use the matching descriptor/message key, never a shared turn key.
  readUnresolvedKeys?: () => string[];
  readPendingKeys?: () => string[];
  readBoundaryState?: (boundary: VirtualizedBoundary) => VirtualizedBoundaryState;
  onTopConfirmed?: (accumulator: PreparedAccumulator<T>) => void;
  harvest: (accumulator: PreparedAccumulator<T>) => Promise<{ added: number; updated: number }>;
};

export type VirtualizedPassResult = {
  reachedTop: boolean;
  reachedBottom: boolean;
  steps: number;
  maxScrollExtent: number;
  reasons: string[];
  unresolvedKeys: string[];
  stoppedAtKey: boolean;
};

export type VirtualizedPassOptions = {
  maxSteps?: number;
  stableSamples?: number;
  pollMs?: number;
  stepTimeoutMs?: number;
  boundaryTimeoutMs?: number;
  overlapRatio?: number;
  maxOverlapRecoveries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  deadline?: number;
  stopAtKey?: string;
  scanUpwards?: boolean;
  holdAtTop?: boolean;
};

const PASS_DEFAULTS = Object.freeze({
  stableSamples: 2,
  pollMs: 40,
  stepTimeoutMs: 1200,
  boundaryTimeoutMs: 30_000,
  overlapRatio: 0.65,
  maxOverlapRecoveries: 4,
  maxBoundaryRecoveries: 4,
});
const EMERGENCY_TOTAL_DEADLINE_MS = 300_000;

function boundedInteger(value: unknown, fallback: number, min: number, max: number, allowZero = false): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function boundedRatio(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(0.95, Math.max(0.1, number));
}

function invalidateAccumulatorIdentity<T>(accumulator: PreparedAccumulator<T>): void {
  accumulator.records = [];
  accumulator.conversationKey = '';
  accumulator.identityVerified = false;
  accumulator.completeness = 'partial';
}

function contentFreeWindowSignature(identity: string, metrics: ScrollMetrics, keys: string[]): string {
  return `${identity}|${metrics.top}|${metrics.scrollHeight}|${metrics.clientHeight}|${keys.join('\u001f')}`;
}

export async function runVirtualizedPass<T>(
  runtime: Pick<ScrollRuntime, 'document' | 'window'>,
  adapter: VirtualizedPassAdapter<T>,
  accumulator: PreparedAccumulator<T>,
  options: VirtualizedPassOptions = {},
): Promise<VirtualizedPassResult> {
  const maxSteps = boundedInteger(options.maxSteps, Number.POSITIVE_INFINITY, 1, 2000);
  const stableSamples = boundedInteger(options.stableSamples, PASS_DEFAULTS.stableSamples, 1, 10);
  const pollMs = boundedInteger(options.pollMs, PASS_DEFAULTS.pollMs, 0, 5000, true);
  const stepTimeoutMs = boundedInteger(options.stepTimeoutMs, PASS_DEFAULTS.stepTimeoutMs, 1, 60_000);
  const boundaryTimeoutMs = boundedInteger(options.boundaryTimeoutMs, PASS_DEFAULTS.boundaryTimeoutMs, 1, 120_000);
  const overlapRatio = boundedRatio(options.overlapRatio, PASS_DEFAULTS.overlapRatio);
  const maxOverlapRecoveries = boundedInteger(
    options.maxOverlapRecoveries,
    PASS_DEFAULTS.maxOverlapRecoveries,
    0,
    20,
    true,
  );
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const deadline = Number.isFinite(options.deadline) ? Number(options.deadline) : Number.POSITIVE_INFINITY;
  const reasons: string[] = [];
  const addReason = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    addPreparedReason(accumulator, reason);
  };
  const deadlineExceeded = (): boolean => {
    if (now() <= deadline) return false;
    addReason('total_deadline_exhausted');
    return true;
  };

  const originalIdentity = String(adapter.sampleIdentity() || '').trim();
  const root = resolveScrollRoot(runtime, adapter.getScrollSeed());
  let reachedTop = false;
  let reachedBottom = false;
  let stoppedAtKey = false;
  const upwards = options.scanUpwards === true || !!options.stopAtKey;
  let steps = 0;
  let maxScrollExtent = 0;
  let previousTop = 0;
  let overlapRecoveries = 0;
  let boundaryRecoveries = 0;
  const unresolvedKeys = new Set<string>();
  const result = (keys: string[] = []): VirtualizedPassResult => ({
    reachedTop,
    reachedBottom,
    stoppedAtKey,
    steps,
    maxScrollExtent,
    reasons,
    unresolvedKeys: keys,
  });
  const readBoundaryState = (boundary: VirtualizedBoundary): VirtualizedBoundaryState | null => {
    if (!adapter.readBoundaryState) return 'confirmed';
    try {
      const state = adapter.readBoundaryState(boundary);
      if (state === 'confirmed' || state === 'pending' || state === 'unverified') return state;
      addReason('pass_failed');
      return null;
    } catch (_error) {
      addReason('pass_failed');
      return null;
    }
  };
  const readUnresolvedKeys = (): string[] | null => {
    try {
      const output: string[] = [];
      for (const key of adapter.readUnresolvedKeys?.() || []) {
        const normalized = String(key || '').trim();
        if (normalized) output.push(normalized);
      }
      return output;
    } catch (_error) {
      addReason('pass_failed');
      return null;
    }
  };
  const rememberUnresolvedKeys = (keys: string[]) => {
    for (const key of keys) unresolvedKeys.add(key);
  };
  const clearResolvedKeys = () => {
    for (const record of accumulator.records) {
      unresolvedKeys.delete(record.key);
    }
  };

  if (!originalIdentity) {
    addReason('missing_identity');
    invalidateAccumulatorIdentity(accumulator);
    return result();
  }

  const validateAfterAwait = (): boolean => {
    if (!isDocumentScrollRoot(runtime.document, root) && !root.isConnected) {
      addReason('root_detached');
      return false;
    }
    if (resolveScrollRoot(runtime, adapter.getScrollSeed()) !== root) {
      addReason('root_replaced');
      return false;
    }
    if (String(adapter.sampleIdentity() || '').trim() !== originalIdentity) {
      addReason('identity_changed');
      return false;
    }
    return true;
  };

  type StableWindow = { metrics: ScrollMetrics; keys: string[]; unresolvedKeys: string[] };

  const stabilize = async (): Promise<StableWindow | null> => {
    const deadline = now() + stepTimeoutMs;
    let lastSignature = '';
    let stableCount = 0;
    let latest: { metrics: ScrollMetrics; keys: string[]; unresolvedKeys: string[] } | null = null;
    while (now() <= deadline) {
      const metrics = readScrollMetrics(runtime, root);
      const keys = adapter
        .readDescriptorKeys()
        .map((key) => String(key || '').trim())
        .filter(Boolean);
      const currentUnresolvedKeys = readUnresolvedKeys();
      if (!currentUnresolvedKeys) return null;
      const currentPendingKeys = adapter.readPendingKeys ? adapter.readPendingKeys() : currentUnresolvedKeys;
      latest = { metrics, keys, unresolvedKeys: currentUnresolvedKeys };
      const signature = contentFreeWindowSignature(originalIdentity, metrics, keys);
      if (signature === lastSignature) stableCount += 1;
      else {
        lastSignature = signature;
        stableCount = 1;
      }
      if (stableCount >= stableSamples && !currentPendingKeys.length) return latest;
      await sleep(pollMs);
      if (deadlineExceeded() || !validateAfterAwait()) return null;
    }
    if (
      latest &&
      !latest.unresolvedKeys.length &&
      !(options.holdAtTop && isAtScrollTop(latest.metrics) && readBoundaryState('top') === 'pending')
    )
      addReason('step_timeout');
    return latest;
  };

  const recoverRegressedBottom = async (metrics: ScrollMetrics): Promise<StableWindow | null> => {
    if (boundaryRecoveries >= PASS_DEFAULTS.maxBoundaryRecoveries) {
      addReason('boundary_unstable');
      return null;
    }
    const stepBack = Math.max(1, Math.floor(metrics.clientHeight * overlapRatio));
    const recoveryTop = Math.max(0, metrics.top - stepBack);
    if (recoveryTop >= metrics.top) {
      addReason('boundary_unstable');
      return null;
    }
    boundaryRecoveries += 1;
    writeScrollPosition(runtime, root, metrics.left, recoveryTop);
    return stabilize();
  };

  const acquireLogicalTop = async (previousWindow?: StableWindow): Promise<StableWindow | null> => {
    let lastSignature = '';
    let lastPendingSignature = '';
    let progressDeadline = now() + boundaryTimeoutMs;
    const waitingKeys = previousWindow ? new Set(previousWindow.keys) : null;
    while (!deadlineExceeded()) {
      if (!options.holdAtTop || !previousWindow) writeScrollPosition(runtime, root, 0, 0);
      const stable = await stabilize();
      if (!stable) return null;
      maxScrollExtent = Math.max(maxScrollExtent, stable.metrics.scrollHeight);
      const keys = stable.keys.join('\u001f');
      const firstKnown = waitingKeys ? stable.keys.findIndex((key) => waitingKeys.has(key)) : -1;
      const hasOlderMessages = firstKnown > 0 && stable.keys.slice(0, firstKnown).some((key) => !waitingKeys!.has(key));
      if (
        options.holdAtTop &&
        previousWindow &&
        (hasOlderMessages ||
          (stable.metrics.top > 0 && stable.metrics.scrollHeight > previousWindow.metrics.scrollHeight))
      )
        return stable;
      const signature = options.holdAtTop
        ? keys
        : contentFreeWindowSignature(originalIdentity, stable.metrics, stable.keys);
      if ((!options.holdAtTop || !previousWindow) && signature !== lastSignature) {
        lastSignature = signature;
        progressDeadline = now() + boundaryTimeoutMs;
      }
      if (!isAtScrollTop(stable.metrics)) {
        if (options.holdAtTop) {
          addReason('scroll_stalled');
          return null;
        }
        await sleep(Math.max(1, pollMs));
        if (!validateAfterAwait()) return null;
        continue;
      }
      const state = readBoundaryState('top');
      if (!state) return null;
      if (state === 'confirmed') {
        try {
          adapter.onTopConfirmed?.(accumulator);
        } catch (_error) {
          addReason('pass_failed');
          return null;
        }
        reachedTop = true;
        return stable;
      }
      // Unknown is not loading, and neither a scroll offset nor a timeout proves history exhaustion.
      if (state === 'unverified') return null;
      if (!options.holdAtTop && signature === lastPendingSignature) {
        const maxTop = Math.max(0, stable.metrics.scrollHeight - stable.metrics.clientHeight);
        const reentryTop = Math.min(maxTop, Math.max(1, Math.floor(stable.metrics.clientHeight * overlapRatio)));
        if (reentryTop > 0) {
          writeScrollPosition(runtime, root, stable.metrics.left, reentryTop);
          await sleep(Math.max(1, pollMs));
          if (!validateAfterAwait()) return null;
        }
      }
      lastPendingSignature = signature;
      if (now() > progressDeadline) {
        addReason('boundary_stalled');
        return null;
      }
      await sleep(Math.max(1, pollMs));
      if (!validateAfterAwait()) return null;
    }
    return null;
  };

  const waitForLogicalBottom = async (): Promise<{ stable: StableWindow | null; confirmed: boolean }> => {
    let lastSignature = '';
    let progressDeadline = now() + boundaryTimeoutMs;
    while (!deadlineExceeded()) {
      const stable = await stabilize();
      if (!stable) return { stable: null, confirmed: false };
      const previousExtent = maxScrollExtent;
      maxScrollExtent = Math.max(maxScrollExtent, stable.metrics.scrollHeight);
      if (stable.metrics.scrollHeight + 1 < previousExtent) {
        const recovered = await recoverRegressedBottom(stable.metrics);
        return { stable: recovered, confirmed: false };
      } else {
        boundaryRecoveries = 0;
        if (isAtScrollBottom(stable.metrics)) {
          const state = readBoundaryState('bottom');
          if (!state) return { stable: null, confirmed: false };
          if (state === 'unverified') return { stable, confirmed: false };
          if (state === 'confirmed') return { stable, confirmed: true };
        } else return { stable, confirmed: false };
      }
      const signature = contentFreeWindowSignature(originalIdentity, stable.metrics, stable.keys);
      if (signature !== lastSignature) {
        lastSignature = signature;
        progressDeadline = now() + boundaryTimeoutMs;
      }
      if (now() > progressDeadline) {
        addReason('boundary_stalled');
        return { stable, confirmed: false };
      }
      await sleep(Math.max(1, pollMs));
      if (!validateAfterAwait()) return { stable: null, confirmed: false };
    }
    return { stable: null, confirmed: false };
  };

  try {
    if (deadlineExceeded()) return result();
    if (upwards && readBoundaryState('bottom') === 'unverified') return result();
    let stable = upwards ? await stabilize() : await acquireLogicalTop();
    if (!stable || (!upwards && !reachedTop)) return result();
    if (upwards && isAtScrollBottom(stable.metrics)) reachedBottom = readBoundaryState('bottom') === 'confirmed';
    previousTop = stable.metrics.top;

    while (steps < maxSteps) {
      if (deadlineExceeded() || !validateAfterAwait()) break;
      const knownKeys = new Set(accumulator.records.map((record) => record.key));
      const hasOverlap = !knownKeys.size || stable.keys.some((key) => knownKeys.has(key));
      if (!hasOverlap && overlapRecoveries < maxOverlapRecoveries && !upwards && stable.metrics.top > previousTop + 1) {
        overlapRecoveries += 1;
        const recoveryTop = Math.floor((previousTop + stable.metrics.top) / 2);
        writeScrollPosition(runtime, root, stable.metrics.left, recoveryTop);
        stable = await stabilize();
        if (!stable) break;
        continue;
      }
      if (!hasOverlap && knownKeys.size) addReason('order_unanchored');
      rememberUnresolvedKeys(stable.unresolvedKeys);

      if (deadlineExceeded()) break;
      const checkpoint = accumulator.records;
      try {
        await adapter.harvest(accumulator);
      } catch (_error) {
        accumulator.records = checkpoint;
        addReason('extraction_error');
        break;
      }
      if (deadlineExceeded() || !validateAfterAwait()) {
        accumulator.records = checkpoint;
        if (accumulator.reasons.includes('identity_changed')) invalidateAccumulatorIdentity(accumulator);
        break;
      }
      clearResolvedKeys();
      steps += 1;
      if (
        options.stopAtKey &&
        accumulator.records.some((record) => record.key === options.stopAtKey) &&
        !accumulator.reasons.includes('order_unanchored') &&
        !accumulator.reasons.includes('order_conflict')
      ) {
        stoppedAtKey = true;
        break;
      }
      const metrics = readScrollMetrics(runtime, root);
      if (upwards) {
        maxScrollExtent = Math.max(maxScrollExtent, metrics.scrollHeight);
        if (isAtScrollTop(metrics)) {
          const topState = readBoundaryState('top');
          if (!topState) break;
          if (topState === 'unverified') break;
          if (topState === 'confirmed') {
            try {
              adapter.onTopConfirmed?.(accumulator);
              reachedTop = true;
            } catch (_error) {
              addReason('pass_failed');
            }
            break;
          }
          if (steps >= maxSteps) {
            addReason('step_budget_exhausted');
            break;
          }
          const top = await acquireLogicalTop(options.holdAtTop ? stable : undefined);
          if (!top) break;
          stable = top;
          previousTop = stable.metrics.top;
          // Newly loaded turns at the logical top must be harvested before declaring success.
          continue;
        }
        previousTop = metrics.top;
        const stepSize = Math.max(1, Math.floor(metrics.clientHeight * overlapRatio));
        const nextTop = Math.max(0, metrics.top - stepSize);
        if (nextTop >= metrics.top) {
          addReason('scroll_stalled');
          break;
        }
        const knownAfterHarvest = new Set(accumulator.records.map((record) => record.key));
        const beforeDistance = metrics.scrollHeight - metrics.clientHeight - metrics.top;
        writeScrollPosition(runtime, root, metrics.left, nextTop);
        const nextWindow = await stabilize();
        if (!nextWindow) break;
        const afterDistance =
          nextWindow.metrics.scrollHeight - nextWindow.metrics.clientHeight - nextWindow.metrics.top;
        const firstKnown = nextWindow.keys.findIndex((key) => knownAfterHarvest.has(key));
        const hasOlderMessages =
          firstKnown > 0 && nextWindow.keys.slice(0, firstKnown).some((key) => !knownAfterHarvest.has(key));
        const requestedAdvance = metrics.top - nextTop;
        const observedAdvance = afterDistance - beforeDistance;
        const movedTowardsOlder = observedAdvance > 1 && Math.abs(observedAdvance - requestedAdvance) <= 2;
        if (!movedTowardsOlder && !hasOlderMessages) {
          addReason('scroll_stalled');
          break;
        }
        stable = nextWindow;
        continue;
      }
      const previousExtent = maxScrollExtent;
      maxScrollExtent = Math.max(maxScrollExtent, metrics.scrollHeight);
      if (isAtScrollBottom(metrics)) {
        if (metrics.scrollHeight + 1 < previousExtent) {
          const recovered = await recoverRegressedBottom(metrics);
          if (!recovered) break;
          stable = recovered;
          previousTop = stable.metrics.top;
          continue;
        }
        boundaryRecoveries = 0;
        const boundaryState = readBoundaryState('bottom');
        if (!boundaryState) break;
        if (boundaryState === 'confirmed') {
          reachedBottom = true;
          break;
        }
        const bottom = await waitForLogicalBottom();
        if (!bottom.stable) break;
        stable = bottom.stable;
        if (bottom.confirmed) {
          reachedBottom = true;
          break;
        }
        if (reasons.includes('boundary_stalled') || reasons.includes('boundary_unstable')) break;
        previousTop = stable.metrics.top;
        continue;
      }

      previousTop = metrics.top;
      const stepSize = Math.max(1, Math.floor(metrics.clientHeight * overlapRatio));
      const maxTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
      const nextTop = Math.min(maxTop, metrics.top + stepSize);
      if (nextTop <= metrics.top) {
        addReason('scroll_stalled');
        break;
      }
      writeScrollPosition(runtime, root, metrics.left, nextTop);
      stable = await stabilize();
      if (!stable) break;
    }
    if (steps >= maxSteps && !(upwards ? stoppedAtKey || reachedTop : reachedBottom))
      addReason('step_budget_exhausted');
  } catch (_error) {
    addReason('pass_failed');
  }

  return result(Array.from(unresolvedKeys));
}

export type VirtualizedSweepOptions = VirtualizedPassOptions & {
  totalDeadlineMs?: number;
};

export type VirtualizedSweepResult = {
  completeness: 'complete' | 'partial';
  steps: number;
  maxScrollExtent: number;
  reachedTop: boolean;
  reachedBottom: boolean;
  stoppedAtKey: boolean;
  reasons: string[];
};

const INCOMPLETE_REASONS = new Set([
  'invalid_reason',
  'missing_identity',
  'unstable_identity',
  'restore_failed',
  'step_timeout',
  'step_budget_exhausted',
  'total_deadline_exhausted',
  'root_detached',
  'root_replaced',
  'identity_changed',
  'order_unanchored',
  'order_conflict',
  'unresolved_turn',
  'pass_failed',
  'extraction_error',
  'scroll_stalled',
  'top_not_reached',
  'bottom_not_reached',
  'boundary_stalled',
  'boundary_unstable',
  'final_live_changed',
]);

export async function runVirtualizedSweep<T>(
  runtime: Pick<ScrollRuntime, 'document' | 'window'>,
  adapter: VirtualizedPassAdapter<T>,
  accumulator: PreparedAccumulator<T>,
  options: VirtualizedSweepOptions = {},
): Promise<VirtualizedSweepResult> {
  const totalDeadlineMs = boundedInteger(
    options.totalDeadlineMs,
    EMERGENCY_TOTAL_DEADLINE_MS,
    1,
    EMERGENCY_TOTAL_DEADLINE_MS,
  );
  const now = options.now || Date.now;
  const deadline = Number.isFinite(totalDeadlineMs) ? now() + totalDeadlineMs : Number.POSITIVE_INFINITY;
  const sweepIdentity = String(adapter.sampleIdentity() || '').trim();
  const validateSweepIdentity = (): boolean => {
    const currentIdentity = String(adapter.sampleIdentity() || '').trim();
    if (sweepIdentity && currentIdentity === sweepIdentity) return true;
    addPreparedReason(accumulator, sweepIdentity ? 'identity_changed' : 'missing_identity');
    invalidateAccumulatorIdentity(accumulator);
    return false;
  };
  let pass: VirtualizedPassResult = {
    reachedTop: false,
    reachedBottom: false,
    stoppedAtKey: false,
    steps: 0,
    maxScrollExtent: 0,
    reasons: [],
    unresolvedKeys: [],
  };
  if (validateSweepIdentity()) {
    if (now() > deadline) addPreparedReason(accumulator, 'total_deadline_exhausted');
    else pass = await runVirtualizedPass(runtime, adapter, accumulator, { ...options, deadline });
  }
  if (validateSweepIdentity() && now() > deadline) addPreparedReason(accumulator, 'total_deadline_exhausted');

  if (pass.unresolvedKeys.length) addPreparedReason(accumulator, 'unresolved_turn');
  if (!pass.reachedTop && !pass.stoppedAtKey) addPreparedReason(accumulator, 'top_not_reached');
  if (!pass.reachedBottom) addPreparedReason(accumulator, 'bottom_not_reached');
  const hasBlockingReason = accumulator.reasons.some((reason) => INCOMPLETE_REASONS.has(reason));
  const complete =
    pass.reachedTop &&
    pass.reachedBottom &&
    !pass.stoppedAtKey &&
    accumulator.identityVerified &&
    !pass.unresolvedKeys.length &&
    !hasBlockingReason;
  accumulator.completeness = complete ? 'complete' : 'partial';
  accumulator.sweepMetrics = {
    steps: pass.steps,
    maxScrollExtent: pass.maxScrollExtent,
    reachedTop: pass.reachedTop,
    reachedBottom: pass.reachedBottom,
    stoppedAtKey: pass.stoppedAtKey,
  };
  return {
    completeness: accumulator.completeness,
    steps: pass.steps,
    maxScrollExtent: pass.maxScrollExtent,
    reachedTop: pass.reachedTop,
    reachedBottom: pass.reachedBottom,
    stoppedAtKey: pass.stoppedAtKey,
    reasons: accumulator.reasons.slice(),
  };
}

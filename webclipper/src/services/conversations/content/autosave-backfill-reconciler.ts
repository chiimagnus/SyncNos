import normalizeApi from '@services/shared/normalize.ts';

const IDENTITY_PREFIX_LEN = 96;
const MIN_OVERLAP_FOR_LONG_WINDOWS = 8;

type BackfillComparable = {
  role: string;
  identityHash: string;
};

function normalizeContent(value: unknown): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.normalizeText === 'function') {
    return normalize.normalizeText(value);
  }
  return String(value || '');
}

function getMessageIdentityHash(message: any): string {
  const role = String(message?.role || 'assistant').trim() || 'assistant';
  const text = normalizeContent(message?.contentText);
  const markdownRaw = message?.contentMarkdown && String(message.contentMarkdown).trim() ? String(message.contentMarkdown) : '';
  const markdown = markdownRaw ? normalizeContent(markdownRaw) : '';
  const full = text || markdown;
  const clipped = full ? full.slice(0, IDENTITY_PREFIX_LEN) : '';
  const normalize = normalizeApi as any;
  const base = `${role}|${clipped}`;
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(base));
  return base;
}

function toComparable(messages: any[]): BackfillComparable[] {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    role: String(message?.role || 'assistant').trim() || 'assistant',
    identityHash: getMessageIdentityHash(message),
  }));
}

function computeRequiredOverlap(localLen: number, pageLen: number): number {
  const overlapBasis = Math.min(localLen, pageLen);
  if (overlapBasis <= 2) return overlapBasis;
  return Math.min(MIN_OVERLAP_FOR_LONG_WINDOWS, Math.max(2, Math.floor(overlapBasis * 0.6)));
}

function findBestOverlap(
  localHashes: string[],
  pageHashes: string[],
): { localStart: number; pageStart: number; length: number } | null {
  let best: { localStart: number; pageStart: number; length: number } | null = null;
  for (let localStart = 0; localStart < localHashes.length; localStart += 1) {
    for (let pageStart = 0; pageStart < pageHashes.length; pageStart += 1) {
      if (localHashes[localStart] !== pageHashes[pageStart]) continue;
      let length = 0;
      while (
        localStart + length < localHashes.length &&
        pageStart + length < pageHashes.length &&
        localHashes[localStart + length] === pageHashes[pageStart + length]
      ) {
        length += 1;
      }
      if (!best || length > best.length) {
        best = { localStart, pageStart, length };
      }
    }
  }
  return best;
}

function assignBackfillKeys(messages: any[], comparables: BackfillComparable[], stateKeyHash: string) {
  const occurrenceByIdentity = new Map<string, number>();
  const added: any[] = [];
  const addedKeys: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const comparable = comparables[index];
    if (!message || !comparable) continue;
    const nextOcc = (occurrenceByIdentity.get(comparable.identityHash) || 0) + 1;
    occurrenceByIdentity.set(comparable.identityHash, nextOcc);
    const key = `autosave_${stateKeyHash}_${comparable.identityHash}_bf${nextOcc}`;
    added.push({ ...message, messageKey: key });
    addedKeys.push(key);
  }
  return { added, addedKeys };
}

function computePageSignature(pageComparables: BackfillComparable[]): string {
  const normalize = normalizeApi as any;
  const serialized = pageComparables.map((entry) => `${entry.role}:${entry.identityHash}`).join('|');
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(serialized));
  return serialized;
}

export function reconcileAutoSaveBackfill(input: {
  localTailMessages: any[];
  pageWindowMessages: any[];
  stateKeyHash: string;
}): {
  ok: boolean;
  addedMessages: any[];
  diff: { added: string[]; updated: string[]; removed: string[] };
  pageSignature: string;
} {
  const localMessages = Array.isArray(input.localTailMessages) ? input.localTailMessages : [];
  const pageMessages = Array.isArray(input.pageWindowMessages) ? input.pageWindowMessages : [];
  const stateKeyHash = String(input.stateKeyHash || '').trim();
  const localComparable = toComparable(localMessages);
  const pageComparable = toComparable(pageMessages);
  const pageSignature = computePageSignature(pageComparable);

  if (!pageMessages.length) {
    return {
      ok: true,
      addedMessages: [],
      diff: { added: [], updated: [], removed: [] },
      pageSignature,
    };
  }

  if (!stateKeyHash) {
    return {
      ok: false,
      addedMessages: [],
      diff: { added: [], updated: [], removed: [] },
      pageSignature,
    };
  }

  if (localMessages.length === 0) {
    const assigned = assignBackfillKeys(pageMessages, pageComparable, stateKeyHash);
    return {
      ok: true,
      addedMessages: assigned.added,
      diff: { added: assigned.addedKeys, updated: [], removed: [] },
      pageSignature,
    };
  }

  const overlap = findBestOverlap(
    localComparable.map((entry) => entry.identityHash),
    pageComparable.map((entry) => entry.identityHash),
  );
  const requiredOverlap = computeRequiredOverlap(localComparable.length, pageComparable.length);
  if (!overlap || overlap.length < requiredOverlap) {
    return {
      ok: false,
      addedMessages: [],
      diff: { added: [], updated: [], removed: [] },
      pageSignature,
    };
  }

  const prefixMessages = pageMessages.slice(0, overlap.pageStart);
  const prefixComparable = pageComparable.slice(0, overlap.pageStart);
  const suffixStart = overlap.pageStart + overlap.length;
  const suffixMessages = pageMessages.slice(suffixStart);
  const suffixComparable = pageComparable.slice(suffixStart);
  const candidates = prefixMessages.concat(suffixMessages);
  const candidateComparable = prefixComparable.concat(suffixComparable);
  const assigned = assignBackfillKeys(candidates, candidateComparable, stateKeyHash);

  return {
    ok: true,
    addedMessages: assigned.added,
    diff: { added: assigned.addedKeys, updated: [], removed: [] },
    pageSignature,
  };
}


import {
  computeRequiredOverlap,
  computeSuffixPrefixOverlap,
  fingerprintHash,
  getMessageIdentityMeta,
} from '@services/conversations/content/autosave-identity-utils.ts';

type BackfillComparable = {
  role: string;
  identityHash: string;
};

function toComparable(messages: any[]): BackfillComparable[] {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const meta = getMessageIdentityMeta(message);
    return {
      role: meta.role,
      identityHash: meta.identityHash,
    };
  });
}

function assignBackfillKeys(
  messages: any[],
  comparables: BackfillComparable[],
  stateKeyHash: string,
  kind: 's' | 'a' | 'h',
) {
  const occurrenceByIdentity = new Map<string, number>();
  const added: any[] = [];
  const addedKeys: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const comparable = comparables[index];
    if (!message || !comparable) continue;
    const nextOcc = (occurrenceByIdentity.get(comparable.identityHash) || 0) + 1;
    occurrenceByIdentity.set(comparable.identityHash, nextOcc);
    const incomingKeyRaw = String(message?.messageKey || '').trim();
    const fallbackIncomingKey = incomingKeyRaw.startsWith('fallback_');
    const key = incomingKeyRaw && !fallbackIncomingKey ? incomingKeyRaw : `autosave_${stateKeyHash}_${comparable.identityHash}_${kind}${nextOcc}`;
    added.push({ ...message, messageKey: key });
    addedKeys.push(key);
  }
  return { added, addedKeys };
}

function computePageSignature(pageComparables: BackfillComparable[]): string {
  const serialized = pageComparables.map((entry) => `${entry.role}:${entry.identityHash}`).join('|');
  return fingerprintHash(serialized);
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
    // First-write: match incremental engine's seed key shape to avoid same-tick duplication.
    const assigned = assignBackfillKeys(pageMessages, pageComparable, stateKeyHash, 's');
    return {
      ok: true,
      addedMessages: assigned.added,
      diff: { added: assigned.addedKeys, updated: [], removed: [] },
      pageSignature,
    };
  }

  const localHashes = localComparable.map((entry) => entry.identityHash);
  const pageHashes = pageComparable.map((entry) => entry.identityHash);
  const requiredOverlap = computeRequiredOverlap(localComparable.length, pageComparable.length);
  const overlapForward = computeSuffixPrefixOverlap(localHashes, pageHashes, requiredOverlap);
  const overlapBackward = overlapForward > 0 ? 0 : computeSuffixPrefixOverlap(pageHashes, localHashes, requiredOverlap);

  let candidates: any[] = [];
  let candidateComparable: BackfillComparable[] = [];
  if (overlapForward > 0) {
    candidates = pageMessages.slice(overlapForward);
    candidateComparable = pageComparable.slice(overlapForward);
  } else if (overlapBackward > 0) {
    const prefixEnd = Math.max(0, pageMessages.length - overlapBackward);
    candidates = pageMessages.slice(0, prefixEnd);
    candidateComparable = pageComparable.slice(0, prefixEnd);
  } else {
    return {
      ok: false,
      addedMessages: [],
      diff: { added: [], updated: [], removed: [] },
      pageSignature,
    };
  }

  const assigned = assignBackfillKeys(
    candidates,
    candidateComparable,
    stateKeyHash,
    overlapForward > 0 ? 'a' : 'h',
  );

  return {
    ok: true,
    addedMessages: assigned.added,
    diff: { added: assigned.addedKeys, updated: [], removed: [] },
    pageSignature,
  };
}

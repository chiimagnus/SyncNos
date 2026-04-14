import {
  computeRequiredOverlap,
  fingerprintHash,
  getMessageIdentityMeta,
} from '@services/conversations/content/autosave-identity-utils.ts';

type BackfillComparable = {
  role: string;
  identityHash: string;
  weakIdentityHash: string;
  text: string;
  markdown: string;
};

function toComparable(messages: any[]): BackfillComparable[] {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const meta = getMessageIdentityMeta(message);
    const weakMeta = getMessageIdentityMeta(message, 32);
    return {
      role: meta.role,
      identityHash: meta.identityHash,
      weakIdentityHash: weakMeta.identityHash,
      text: meta.text,
      markdown: meta.markdown,
    };
  });
}

function isPrefixOrFillingUpdate(
  prev: { text: string; markdown: string },
  next: { text: string; markdown: string },
): { acceptable: boolean } {
  const prevText = prev.text || '';
  const nextText = next.text || '';
  const prevMarkdown = prev.markdown || '';
  const nextMarkdown = next.markdown || '';

  const textFilled = !prevText && !!nextText;
  const markdownFilled = !prevMarkdown && !!nextMarkdown;

  const textGrew = !!(prevText && nextText && nextText.startsWith(prevText) && nextText.length > prevText.length);
  const markdownGrew = !!(
    prevMarkdown &&
    nextMarkdown &&
    nextMarkdown.startsWith(prevMarkdown) &&
    nextMarkdown.length > prevMarkdown.length
  );

  return { acceptable: textFilled || markdownFilled || textGrew || markdownGrew };
}

function comparableMatches(a: BackfillComparable | undefined, b: BackfillComparable | undefined): boolean {
  if (!a || !b) return false;
  if (a.identityHash && a.identityHash === b.identityHash) return true;
  if (a.weakIdentityHash && a.weakIdentityHash === b.weakIdentityHash) return true;
  if (a.role !== b.role) return false;

  const decision = isPrefixOrFillingUpdate(
    { text: a.text || '', markdown: a.markdown || '' },
    { text: b.text || '', markdown: b.markdown || '' },
  );
  if (decision.acceptable) return true;

  const reverseDecision = isPrefixOrFillingUpdate(
    { text: b.text || '', markdown: b.markdown || '' },
    { text: a.text || '', markdown: a.markdown || '' },
  );
  return reverseDecision.acceptable;
}

function computeSuffixPrefixOverlapFlexible(
  prev: BackfillComparable[],
  cur: BackfillComparable[],
  requiredOverlap: number,
): number {
  const prevLen = prev.length;
  const curLen = cur.length;
  const maxOverlap = Math.min(prevLen, curLen);
  if (maxOverlap <= 0) return 0;

  for (let overlap = maxOverlap; overlap >= requiredOverlap; overlap -= 1) {
    const start = prevLen - overlap;
    let ok = true;
    for (let i = 0; i < overlap; i += 1) {
      if (!comparableMatches(prev[start + i], cur[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return overlap;
  }
  return 0;
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
  // Use weak identity for the signature so streaming/prefix-growth updates don't thrash the retry/completion state.
  const serialized = pageComparables
    .map((entry) => `${entry.role}:${entry.weakIdentityHash || entry.identityHash}`)
    .join('|');
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

  const requiredOverlap = computeRequiredOverlap(localComparable.length, pageComparable.length);
  const overlapForward = computeSuffixPrefixOverlapFlexible(localComparable, pageComparable, requiredOverlap);
  const overlapBackward =
    overlapForward > 0 ? 0 : computeSuffixPrefixOverlapFlexible(pageComparable, localComparable, requiredOverlap);

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

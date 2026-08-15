import type { FactsEpoch, StableConversationReference } from '@services/local-data/contracts';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export type CommentContextIdentityInput =
  | {
      canonicalUrl?: string | null;
      conversationId?: number | null;
      conversation?: StableConversationReference | null;
      factsEpoch?: FactsEpoch | null;
    }
  | null
  | undefined;

export type CommentContextIdentity = {
  canonicalUrl: string;
  conversationId: number | null;
  conversation: StableConversationReference | null;
  factsEpoch: FactsEpoch | null;
};

export type CommentContextTransitionKind = 'same' | 'attach-orphan' | 'url-migrate' | 'conversation-change' | 'invalid';

export type CommentContextTransition = {
  kind: CommentContextTransitionKind;
  previous: CommentContextIdentity | null;
  next: CommentContextIdentity | null;
};

function normalizeConversationReference(value: unknown): StableConversationReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = String((value as StableConversationReference).source || '').trim();
  const conversationKey = String((value as StableConversationReference).conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function normalizeFactsEpoch(value: unknown): FactsEpoch | null {
  return typeof value === 'string' && value ? (value as FactsEpoch) : null;
}

function sameReference(left: StableConversationReference | null, right: StableConversationReference | null): boolean {
  return left?.source === right?.source && left?.conversationKey === right?.conversationKey;
}

function sameConversationIdentity(left: CommentContextIdentity, right: CommentContextIdentity): boolean {
  if (left.conversation || right.conversation) return sameReference(left.conversation, right.conversation);
  return left.conversationId != null && left.conversationId === right.conversationId;
}

function sameFactsObservation(left: CommentContextIdentity, right: CommentContextIdentity): boolean {
  return left.factsEpoch === right.factsEpoch;
}

export function normalizeCommentContextIdentity(input: CommentContextIdentityInput): CommentContextIdentity | null {
  if (!input) return null;
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  if (!canonicalUrl) return null;
  return {
    canonicalUrl,
    conversationId: normalizePositiveInt(input.conversationId),
    conversation: normalizeConversationReference(input.conversation),
    factsEpoch: normalizeFactsEpoch(input.factsEpoch),
  };
}

export function buildCommentContextIdentityKey(input: CommentContextIdentityInput): string {
  const identity = normalizeCommentContextIdentity(input);
  return identity
    ? JSON.stringify([
        identity.canonicalUrl,
        identity.conversationId,
        identity.conversation?.source ?? null,
        identity.conversation?.conversationKey ?? null,
        identity.factsEpoch,
      ])
    : '';
}

export function classifyCommentContextTransition(
  previousInput: CommentContextIdentityInput,
  nextInput: CommentContextIdentityInput,
): CommentContextTransition {
  const previous = normalizeCommentContextIdentity(previousInput);
  const next = normalizeCommentContextIdentity(nextInput);

  if (!next) return { kind: 'invalid', previous, next: null };
  if (!previous) return { kind: 'conversation-change', previous: null, next };

  if (
    previous.canonicalUrl === next.canonicalUrl &&
    previous.conversationId === next.conversationId &&
    sameReference(previous.conversation, next.conversation) &&
    sameFactsObservation(previous, next)
  ) {
    return { kind: 'same', previous, next };
  }
  if (previous.canonicalUrl === next.canonicalUrl && previous.conversationId == null && next.conversationId != null) {
    return { kind: 'attach-orphan', previous, next };
  }
  if (
    previous.canonicalUrl !== next.canonicalUrl &&
    sameConversationIdentity(previous, next) &&
    sameFactsObservation(previous, next)
  ) {
    return { kind: 'url-migrate', previous, next };
  }
  return { kind: 'conversation-change', previous, next };
}

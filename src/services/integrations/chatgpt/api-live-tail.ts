import { markdownToSemanticText } from '@services/shared/markdown-semantic-text';

export const CHATGPT_API_LIVE_TAIL_REASON = 'chatgpt_api_live_tail_unconfirmed';
export const CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON = 'chatgpt_api_live_tail_unresolved';

export type ChatgptApiLiveTurnCapture =
  | { kind: 'none'; conversationId: string }
  | { kind: 'identity_changed'; conversationId: string }
  | { kind: 'unsafe'; conversationId: string }
  | {
      kind: 'candidate';
      conversationId: string;
      userMessage: any;
      assistantMessage: any;
    };

function stableString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function semanticMarkdown(value: unknown): string {
  return markdownToSemanticText(String(value ?? ''), { includeImageAlt: true }).trim();
}

function withPartialReason(snapshot: any, reason: string): any {
  const currentMeta = snapshot?.captureMeta && typeof snapshot.captureMeta === 'object' ? snapshot.captureMeta : {};
  const reasons = new Set<string>();
  for (const value of Array.isArray(currentMeta.reasons) ? currentMeta.reasons : []) {
    const normalized = stableString(value);
    if (normalized) reasons.add(normalized);
  }
  reasons.add(reason);
  return {
    ...snapshot,
    captureMeta: {
      ...currentMeta,
      completeness: 'partial',
      identityVerified: currentMeta.identityVerified === true,
      reasons: Array.from(reasons),
    },
  };
}

function messagesOf(snapshot: any): any[] {
  return Array.isArray(snapshot?.messages) ? snapshot.messages : [];
}

function messageKey(message: any): string {
  return stableString(message?.messageKey);
}

function isSameSemanticMessage(existing: any, incoming: any): boolean {
  return semanticMarkdown(existing?.contentMarkdown) === semanticMarkdown(incoming?.contentMarkdown);
}

function compareAssistantProgress(existing: any, incoming: any): 'same' | 'backend-ahead' | 'live-ahead' | 'diverged' {
  const backend = semanticMarkdown(existing?.contentMarkdown);
  const live = semanticMarkdown(incoming?.contentMarkdown);
  if (backend === live) return 'same';
  if (backend && live && backend.length > live.length && backend.startsWith(live)) return 'backend-ahead';
  if (backend && live && live.length > backend.length && live.startsWith(backend)) return 'live-ahead';
  return 'diverged';
}

function appendMessage(messages: any[], incoming: any): any[] {
  return [...messages, { ...incoming, sequence: messages.length }];
}

/**
 * Overlay only the current DOM turn on top of the canonical backend snapshot.
 * The DOM candidate is accepted only when every message has a stable backend id and
 * the current user message anchors to the backend branch (or can itself be appended).
 */
export function augmentChatgptApiSnapshotWithLiveTurn(
  snapshot: any,
  live: ChatgptApiLiveTurnCapture | null | undefined,
): any {
  if (!live || live.kind === 'none') return snapshot;
  if (live.kind === 'identity_changed') {
    throw Object.assign(new Error('chatgpt_api_navigation_changed'), { code: 'chatgpt_api_navigation_changed' });
  }
  if (live.kind === 'unsafe') return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);

  const conversationId = stableString(snapshot?.conversation?.conversationKey);
  if (!conversationId || conversationId !== stableString(live.conversationId)) {
    throw Object.assign(new Error('chatgpt_api_navigation_changed'), { code: 'chatgpt_api_navigation_changed' });
  }

  const userKey = messageKey(live.userMessage);
  const assistantKey = messageKey(live.assistantMessage);
  if (!userKey || !assistantKey || userKey === assistantKey) {
    return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
  }

  let messages = messagesOf(snapshot).map((message) => ({ ...message }));
  let changed = false;
  const userIndex = messages.findIndex((message) => messageKey(message) === userKey);
  if (userIndex >= 0) {
    const existingUser = messages[userIndex];
    if (existingUser?.role !== 'user' || !isSameSemanticMessage(existingUser, live.userMessage)) {
      return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
    }
  } else {
    messages = appendMessage(messages, live.userMessage);
    changed = true;
  }

  const anchoredUserIndex = messages.findIndex((message) => messageKey(message) === userKey);
  const assistantIndex = messages.findIndex((message) => messageKey(message) === assistantKey);
  if (assistantIndex < 0) {
    // Do not append a competing branch when the backend already owns any visible message after this user turn.
    if (anchoredUserIndex !== messages.length - 1) {
      return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
    }
    messages = appendMessage(messages, live.assistantMessage);
    changed = true;
  } else {
    if (
      assistantIndex <= anchoredUserIndex ||
      messages.slice(anchoredUserIndex + 1, assistantIndex).some((message) => message?.role === 'user')
    ) {
      return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
    }
    const existingAssistant = messages[assistantIndex];
    if (existingAssistant?.role !== 'assistant') {
      return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
    }
    const progress = compareAssistantProgress(existingAssistant, live.assistantMessage);
    if (progress === 'diverged') {
      return withPartialReason(snapshot, CHATGPT_API_LIVE_TAIL_UNRESOLVED_REASON);
    }
    if (progress === 'live-ahead') {
      messages[assistantIndex] = {
        ...live.assistantMessage,
        sequence: existingAssistant.sequence,
      };
      changed = true;
    }
  }

  if (!changed) return snapshot;
  return withPartialReason({ ...snapshot, messages }, CHATGPT_API_LIVE_TAIL_REASON);
}

export const RECOVERED_CONVERSATION_SOURCE = 'recovered';

export function recoveredConversationKey(originalConversationId: number): string {
  return `orphan-${originalConversationId}`;
}

export function recoveredConversationRecord(originalConversationId: number, messages: readonly any[]) {
  const lastActivityAt = messages.reduce((latest, row) => {
    const updatedAt = Number(row?.updatedAt);
    return Number.isFinite(updatedAt) && updatedAt > 0 ? Math.max(latest, updatedAt) : latest;
  }, 0);
  return {
    sourceType: 'chat',
    source: RECOVERED_CONVERSATION_SOURCE,
    conversationKey: recoveredConversationKey(originalConversationId),
    title: `#${originalConversationId}`,
    originalConversationId,
    lastActivityAt,
  };
}

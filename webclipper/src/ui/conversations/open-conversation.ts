import { setPendingOpenConversationId } from './pending-open';

export type OpenConversationDeps = {
  setActiveId: (id: number | null) => void;
  clearSelected?: () => void;
  isNarrow?: boolean;
  onOpenConversation?: (conversationId: number) => void;
};

export function openConversation(conversationId: unknown, deps: OpenConversationDeps): number | null {
  const safeId = Number(conversationId);
  if (!Number.isFinite(safeId) || safeId <= 0) return null;
  const id = Math.floor(safeId);

  deps.clearSelected?.();
  deps.setActiveId(id);

  if (deps.onOpenConversation) {
    deps.onOpenConversation(id);
  } else if (deps.isNarrow) {
    setPendingOpenConversationId(id);
  }

  return id;
}


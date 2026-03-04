import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Conversation, ConversationDetail } from '../../../conversations/domain/models';
import { getConversationDetail, listConversations } from '../../../conversations/client/repo';

type ConversationsAppState = {
  loadingList: boolean;
  listError: string | null;
  items: Conversation[];

  activeId: number | null;
  selectedIds: number[];

  loadingDetail: boolean;
  detailError: string | null;
  detail: ConversationDetail | null;

  selectedConversation: Conversation | null;

  refreshList: () => Promise<void>;
  refreshActiveDetail: () => Promise<void>;
  setActiveId: (id: number | null) => void;
  toggleSelected: (id: number) => void;
  toggleAll: () => void;
  clearSelected: () => void;
};

const ConversationsContext = createContext<ConversationsAppState | null>(null);

async function loadDetailFor(id: number): Promise<ConversationDetail> {
  return getConversationDetail(id);
}

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const selectedConversation = useMemo(
    () => items.find((x) => Number(x.id) === Number(activeId)) ?? null,
    [items, activeId],
  );

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const list = await listConversations();
      setItems(list);

      const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0));
      setSelectedIds((prev) => prev.filter((id) => ids.has(Number(id))));

      setActiveId((prev) => {
        if (prev != null && ids.has(Number(prev))) return prev;
        if (list.length) return Number(list[0].id);
        return null;
      });
    } catch (e) {
      setListError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const refreshActiveDetail = useCallback(async () => {
    const id = Number(activeId);
    if (!Number.isFinite(id) || id <= 0) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    setDetailError(null);
    try {
      const d = await loadDetailFor(id);
      setDetail(d);
    } catch (e) {
      setDetailError((e as any)?.message ?? String(e ?? 'failed'));
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [activeId]);

  useEffect(() => {
    void refreshActiveDetail();
  }, [refreshActiveDetail]);

  const toggleSelected = useCallback((id: number) => {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return;
    setSelectedIds((prev) => (prev.includes(safeId) ? prev.filter((x) => x !== safeId) : [...prev, safeId]));
  }, []);

  const toggleAll = useCallback(() => {
    const allIds = items.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0);
    const allSelected = !!allIds.length && selectedIds.length === allIds.length;
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(allIds);
  }, [items, selectedIds.length]);

  const clearSelected = useCallback(() => setSelectedIds([]), []);

  const value: ConversationsAppState = {
    loadingList,
    listError,
    items,
    activeId,
    selectedIds,
    loadingDetail,
    detailError,
    detail,
    selectedConversation,
    refreshList,
    refreshActiveDetail,
    setActiveId,
    toggleSelected,
    toggleAll,
    clearSelected,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversationsApp() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversationsApp must be used within ConversationsProvider');
  return ctx;
}


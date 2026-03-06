import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Conversation, ConversationDetail } from '../../conversations/domain/models';
import { buildConversationBasename } from '../../conversations/domain/file-naming';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { createZipBlob } from '../../sync/backup/zip-utils';
import { deleteConversations, getConversationDetail, listConversations } from '../../conversations/client/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../sync/repo';

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

  exporting: boolean;
  syncingNotion: boolean;
  syncingObsidian: boolean;
  deleting: boolean;

  refreshList: () => Promise<void>;
  refreshActiveDetail: () => Promise<void>;
  setActiveId: (id: number | null) => void;
  toggleSelected: (id: number) => void;
  toggleAll: (scopeIds?: number[]) => void;
  clearSelected: () => void;

  exportSelectedMarkdown: (opts: { mergeSingle: boolean }) => Promise<void>;
  syncSelectedNotion: () => Promise<void>;
  syncSelectedObsidian: () => Promise<void>;
  deleteSelected: () => Promise<void>;
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

  const [exporting, setExporting] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncingObsidian, setSyncingObsidian] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const toggleAll = useCallback(
    (scopeIds?: number[]) => {
      const allIds = (scopeIds?.length ? scopeIds : items.map((x) => Number(x.id)))
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0);
      const idSet = new Set(allIds);
      const selectedInScope = selectedIds.filter((id) => idSet.has(Number(id)));
      const allSelected = !!allIds.length && selectedInScope.length === allIds.length;
      if (allSelected) setSelectedIds((prev) => prev.filter((id) => !idSet.has(Number(id))));
      else {
        const next = new Set(selectedIds);
        for (const id of allIds) next.add(Number(id));
        setSelectedIds(Array.from(next));
      }
    },
    [items, selectedIds],
  );

  const clearSelected = useCallback(() => setSelectedIds([]), []);

  const exportSelectedMarkdown = useCallback(
    async ({ mergeSingle }: { mergeSingle: boolean }) => {
      const ids = selectedIds.slice();
      if (!ids.length) return;

      setExporting(true);
      try {
        const selectedConversations = items.filter((c) => ids.includes(Number(c.id)));
        if (!selectedConversations.length) return;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const files: Array<{ name: string; data: string }> = [];

        if (mergeSingle) {
          const docs: string[] = [];
          for (const c of selectedConversations) {
            // eslint-disable-next-line no-await-in-loop
            const d = await getConversationDetail(Number(c.id));
            docs.push(formatConversationMarkdown(c, d.messages || []));
          }
          files.push({ name: `webclipper-export-${stamp}.md`, data: docs.join('\n---\n\n') });
        } else {
          for (const c of selectedConversations) {
            // eslint-disable-next-line no-await-in-loop
            const d = await getConversationDetail(Number(c.id));
            files.push({
              name: `${buildConversationBasename(c)}.md`,
              data: formatConversationMarkdown(c, d.messages || []),
            });
          }
        }

        const zipBlob = await createZipBlob(files);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `webclipper-export-${stamp}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        alert((e as any)?.message ?? String(e ?? 'export failed'));
      } finally {
        setExporting(false);
      }
    },
    [items, selectedIds],
  );

  const syncSelectedNotion = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingNotion(true);
    try {
      await syncNotionConversations(ids);
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'notion sync failed'));
    } finally {
      setSyncingNotion(false);
    }
  }, [selectedIds]);

  const syncSelectedObsidian = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingObsidian(true);
    try {
      await syncObsidianConversations(ids);
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'obsidian sync failed'));
    } finally {
      setSyncingObsidian(false);
    }
  }, [selectedIds]);

  const deleteSelected = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;

    setDeleting(true);
    try {
      await deleteConversations(ids);
      setSelectedIds([]);
      await refreshList();
      await refreshActiveDetail();
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setDeleting(false);
    }
  }, [refreshActiveDetail, refreshList, selectedIds]);

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
    exporting,
    syncingNotion,
    syncingObsidian,
    deleting,
    refreshList,
    refreshActiveDetail,
    setActiveId,
    toggleSelected,
    toggleAll,
    clearSelected,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    deleteSelected,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversationsApp() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversationsApp must be used within ConversationsProvider');
  return ctx;
}

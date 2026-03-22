import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { deleteConversations, getConversationDetail, listConversations } from '@services/conversations/client/repo';
import { backfillConversationImages } from '@services/conversations/client/repo';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { resolveDetailHeaderActions } from '@services/integrations/detail-header-actions';
import { UI_EVENT_TYPES, UI_PORT_NAMES } from '@services/protocols/message-contracts';
import { connectPort } from '@services/shared/ports';
import { t } from '@i18n';
import { useConversationSyncFeedback, type ConversationSyncFeedbackState } from './useConversationSyncFeedback';

const LIST_SOURCE_FILTER_STORAGE_KEY = 'webclipper_conversations_source_filter_key';
const LIST_SITE_FILTER_STORAGE_KEY = 'webclipper_conversations_site_filter_key';
const LIST_SITE_FILTER_ALL_KEY = 'all';
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

function parseSyncnosAssetId(url: unknown): number | null {
  const text = String(url || '').trim();
  const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(text);
  if (!matched) return null;
  const id = Number(matched[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function normalizeImageExt(raw: unknown): string {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return 'png';
  if (text === 'jpeg') return 'jpg';
  if (text === 'svg+xml') return 'svg';
  if (text === 'x-icon' || text === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(text) ? text : 'png';
}

function inferImageExtFromAsset(asset: { contentType?: string; url?: string }): string {
  const contentType = String(asset.contentType || '').trim().toLowerCase();
  if (contentType.startsWith('image/')) {
    return normalizeImageExt(contentType.slice('image/'.length));
  }

  const url = String(asset.url || '').trim();
  if (/^data:image\//i.test(url)) {
    const matched = /^data:image\/([a-z0-9.+-]+)/i.exec(url);
    return normalizeImageExt(matched?.[1] || '');
  }

  try {
    const parsed = new URL(url);
    const pathname = String(parsed.pathname || '');
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) {
      return normalizeImageExt(filename.slice(dot + 1));
    }
  } catch (_e) {
    // ignore parse failure, fallback below
  }

  return 'png';
}

async function materializeSyncnosAssetsForExport(input: {
  markdown: string;
  markdownBasename: string;
  conversationId?: number | null;
}): Promise<{ markdown: string; attachments: Array<{ name: string; data: Blob }> }> {
  const markdown = String(input.markdown || '');
  if (!markdown) return { markdown: '', attachments: [] };

  const basename = String(input.markdownBasename || '').trim() || 'conversation';
  const conversationId = Number(input.conversationId);

  const orderedAssetIds: number[] = [];
  const seenAssetIds = new Set<number>();
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = MARKDOWN_IMAGE_RE.exec(markdown)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const assetId = parseSyncnosAssetId(stripAngleBrackets(urlPart));
    if (!assetId) continue;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    orderedAssetIds.push(assetId);
  }
  if (!orderedAssetIds.length) return { markdown, attachments: [] };

  const assetNameById = new Map<number, string>();
  const attachments: Array<{ name: string; data: Blob }> = [];
  let index = 0;

  for (const assetId of orderedAssetIds) {
    // eslint-disable-next-line no-await-in-loop
    const asset = await getImageCacheAssetById({
      id: assetId,
      conversationId: Number.isFinite(conversationId) && conversationId > 0 ? conversationId : null,
    });
    if (!asset) continue;
    index += 1;
    const ext = inferImageExtFromAsset(asset);
    const attachmentName = `${basename}-${index}.${ext}`;
    assetNameById.set(assetId, attachmentName);
    attachments.push({ name: attachmentName, data: asset.blob });
  }

  if (!assetNameById.size) return { markdown, attachments: [] };

  MARKDOWN_IMAGE_RE.lastIndex = 0;
  const rewrittenMarkdown = markdown.replace(MARKDOWN_IMAGE_RE, (_full, altRaw, urlPartRaw, titleRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const title = titleRaw ? String(titleRaw) : '';
    const assetId = parseSyncnosAssetId(stripAngleBrackets(urlPart));
    if (!assetId) return _full;
    const attachmentName = assetNameById.get(assetId);
    if (!attachmentName) return _full;
    const nextPart = urlPart.trim().startsWith('<') ? `<${attachmentName}>` : attachmentName;
    return `![${alt}](${nextPart}${title})`;
  });

  return { markdown: rewrittenMarkdown, attachments };
}

function readLocalStorageValue(key: string): string {
  try {
    return String(localStorage.getItem(key) || '');
  } catch (_e) {
    return '';
  }
}

function writeLocalStorageValue(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_e) {
    // ignore
  }
}

function readInitialListSourceFilterKey(): string {
  const raw = readLocalStorageValue(LIST_SOURCE_FILTER_STORAGE_KEY).trim().toLowerCase();
  if (raw) return raw;

  // Backward compat: older app stored filter under this key.
  const legacy = readLocalStorageValue('webclipper_app_source_filter_key').trim().toLowerCase();
  return legacy || 'all';
}

function readInitialListSiteFilterKey(): string {
  const raw = readLocalStorageValue(LIST_SITE_FILTER_STORAGE_KEY).trim().toLowerCase();
  return raw || LIST_SITE_FILTER_ALL_KEY;
}

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
  detailHeaderActions: DetailHeaderAction[];

  exporting: boolean;
  syncFeedback: ConversationSyncFeedbackState;
  syncingNotion: boolean;
  syncingObsidian: boolean;
  deleting: boolean;

  listSourceFilterKey: string;
  listSiteFilterKey: string;
  setListSourceFilterKeyPersistent: (next: string) => void;
  setListSiteFilterKeyPersistent: (next: string) => void;

  pendingListLocateId: number | null;
  requestListLocate: (conversationId: number) => void;
  consumeListLocate: () => number | null;
  openConversationExternalById: (conversationId: number) => void;

  refreshList: () => Promise<void>;
  refreshActiveDetail: () => Promise<void>;
  setActiveId: (id: number | null) => void;
  toggleSelected: (id: number) => void;
  toggleAll: (scopeIds?: number[]) => void;
  clearSelected: () => void;

  exportSelectedMarkdown: (opts: { mergeSingle: boolean }) => Promise<void>;
  syncSelectedNotion: () => Promise<void>;
  syncSelectedObsidian: () => Promise<void>;
  clearSyncFeedback: () => void;
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
  const activeIdRef = useRef<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const [listSourceFilterKey, setListSourceFilterKey] = useState<string>(() => readInitialListSourceFilterKey());
  const [listSiteFilterKey, setListSiteFilterKey] = useState<string>(() => readInitialListSiteFilterKey());
  const [pendingListLocateId, setPendingListLocateId] = useState<number | null>(null);
  const pendingListLocateIdRef = useRef<number | null>(null);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { feedback: syncFeedback, clearFeedback: clearSyncFeedback, startSync, syncingNotion, syncingObsidian } = useConversationSyncFeedback();

  const selectedConversation = useMemo(
    () => items.find((x) => Number(x.id) === Number(activeId)) ?? null,
    [items, activeId],
  );
  const [detailHeaderActions, setDetailHeaderActions] = useState<DetailHeaderAction[]>([]);

  const setListSourceFilterKeyPersistent = useCallback((next: string) => {
    const value = String(next || 'all').trim().toLowerCase() || 'all';
    setListSourceFilterKey(value);
    writeLocalStorageValue(LIST_SOURCE_FILTER_STORAGE_KEY, value);
  }, []);

  const setListSiteFilterKeyPersistent = useCallback((next: string) => {
    const value = String(next || LIST_SITE_FILTER_ALL_KEY).trim().toLowerCase() || LIST_SITE_FILTER_ALL_KEY;
    setListSiteFilterKey(value);
    writeLocalStorageValue(LIST_SITE_FILTER_STORAGE_KEY, value === LIST_SITE_FILTER_ALL_KEY ? null : value);
  }, []);

  const requestListLocate = useCallback((conversationId: number) => {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) return;
    pendingListLocateIdRef.current = id;
    setPendingListLocateId(id);
  }, []);

  const consumeListLocate = useCallback(() => {
    const id = pendingListLocateIdRef.current;
    pendingListLocateIdRef.current = null;
    setPendingListLocateId(null);
    return Number.isFinite(Number(id)) ? (id as number) : null;
  }, []);

  const openConversationExternalById = useCallback(
    (conversationId: number) => {
      const id = Number(conversationId);
      if (!Number.isFinite(id) || id <= 0) return;
      setListSourceFilterKeyPersistent('all');
      setListSiteFilterKeyPersistent(LIST_SITE_FILTER_ALL_KEY);
      setActiveId(id);
      requestListLocate(id);
    },
    [requestListLocate, setListSiteFilterKeyPersistent, setListSourceFilterKeyPersistent],
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
      setListError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const refreshActiveDetail = useCallback(async () => {
    const id = Number(activeIdRef.current);
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
      setDetailError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
    void refreshActiveDetail();
  }, [activeId, refreshActiveDetail]);

  useEffect(() => {
    let disposed = false;
    let port: any = null;
    let refreshTimer: any = null;
    let pendingList = false;
    let pendingDetail = false;

    const flush = async () => {
      if (disposed) return;
      const doList = pendingList;
      const doDetail = pendingDetail;
      pendingList = false;
      pendingDetail = false;
      refreshTimer = null;

      if (doList) await refreshList().catch(() => {});
      // Only force-refresh detail when the active conversation is known to have changed
      // (or when sync finishes and metadata such as notionPageId is updated).
      if (doDetail) await refreshActiveDetail().catch(() => {});
    };

    const scheduleFlush = () => {
      if (disposed) return;
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        void flush();
      }, 250);
    };

    const connect = () => {
      if (disposed) return;
      try {
        port = connectPort(UI_PORT_NAMES.POPUP_EVENTS);
      } catch (_e) {
        port = null;
        return;
      }

      const onMessage = (message: any) => {
        if (disposed) return;
        if (!message || typeof message !== 'object') return;
        if (message.type !== UI_EVENT_TYPES.CONVERSATIONS_CHANGED) return;

        const payload = (message as any).payload || {};
        pendingList = true;

        const reason = String(payload.reason || '').trim();
        if (reason === 'delete') {
          // Let refreshList() normalize activeId; detail will refresh via the activeId effect.
        } else if (reason === 'syncFinished') {
          pendingDetail = true;
        } else {
          const changedId = Number(payload.conversationId);
          if (Number.isFinite(changedId) && changedId > 0 && Number(activeIdRef.current) === changedId) {
            pendingDetail = true;
          }
          const ids = Array.isArray(payload.conversationIds) ? payload.conversationIds : [];
          if (ids.some((id: any) => Number(id) === Number(activeIdRef.current))) {
            pendingDetail = true;
          }
        }

        scheduleFlush();
      };

      const onDisconnect = () => {
        try {
          port?.onMessage?.removeListener?.(onMessage);
        } catch (_e) {
          // ignore
        }
        port = null;
        if (disposed) return;
        setTimeout(connect, 1000);
      };

      try {
        port?.onMessage?.addListener?.(onMessage);
        port?.onDisconnect?.addListener?.(onDisconnect);
      } catch (_e) {
        try {
          port?.disconnect?.();
        } catch (_e2) {
          // ignore
        }
        port = null;
      }
    };

    connect();

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      try {
        port?.disconnect?.();
      } catch (_e) {
        // ignore
      }
      port = null;
    };
  }, [refreshActiveDetail, refreshList]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedConversation) {
      setDetailHeaderActions([]);
      return;
    }

    setDetailHeaderActions([]);
    void resolveDetailHeaderActions({ conversation: selectedConversation, detail })
      .then((actions) => {
        if (cancelled) return;

        const isArticle = String((selectedConversation as any)?.sourceType || '').trim().toLowerCase() === 'article';
        const safeActions = Array.isArray(actions) ? actions : [];
        if (isArticle) {
          setDetailHeaderActions(safeActions);
          return;
        }

        const conversationId = Number((selectedConversation as any)?.id);
        const conversationUrl = String((selectedConversation as any)?.url || '');

        const cacheImagesAction: DetailHeaderAction | null =
          Number.isFinite(conversationId) && conversationId > 0
            ? {
                id: 'cache-images',
                label: t('detailHeaderCacheImagesLabel'),
                kind: 'open-target',
                provider: 'local',
                slot: 'tools',
                onTrigger: async () => {
                  const res = await backfillConversationImages(conversationId, conversationUrl);
                  await refreshActiveDetail();
                  const updated = Number(res?.updatedMessages) || 0;
                  const downloaded = Number(res?.downloadedCount) || 0;
                  const fromCache = Number(res?.fromCacheCount) || 0;
                  if (!updated) {
                    alert(t('detailHeaderCacheImagesNoop'));
                  } else {
                    const parts = [
                      t('detailHeaderCacheImagesSuccess'),
                      `${t('detailHeaderCacheImagesUpdatedMessages')} ${updated}`,
                      `(${t('detailHeaderCacheImagesDownloaded')}: ${downloaded}, ${t('detailHeaderCacheImagesCacheHits')}: ${fromCache})`,
                    ];
                    alert(parts.filter(Boolean).join(' ').trim());
                  }
                },
              }
            : null;

        setDetailHeaderActions(cacheImagesAction ? [cacheImagesAction, ...safeActions] : safeActions);
      })
      .catch(() => {
        if (!cancelled) setDetailHeaderActions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [detail, selectedConversation]);

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

        const stamp = buildLocalTimestampForFilename();
        const files: Array<{ name: string; data: unknown }> = [];

        if (mergeSingle) {
          const docs: string[] = [];
          for (const c of selectedConversations) {
            // eslint-disable-next-line no-await-in-loop
            const d = await getConversationDetail(Number(c.id));
            docs.push(formatConversationMarkdown(c, d.messages || []));
          }
          const mergedBaseName = `SyncNos-md-${stamp}`;
          const mergedDoc = docs.join('\n---\n\n');
          const mergedMaterialized = await materializeSyncnosAssetsForExport({
            markdown: mergedDoc,
            markdownBasename: mergedBaseName,
          });
          files.push({ name: `${mergedBaseName}.md`, data: mergedMaterialized.markdown });
          for (const attachment of mergedMaterialized.attachments) files.push(attachment);
        } else {
          for (const c of selectedConversations) {
            // eslint-disable-next-line no-await-in-loop
            const d = await getConversationDetail(Number(c.id));
            const basename = buildConversationBasename(c);
            // eslint-disable-next-line no-await-in-loop
            const materialized = await materializeSyncnosAssetsForExport({
              markdown: formatConversationMarkdown(c, d.messages || []),
              markdownBasename: basename,
              conversationId: Number(c.id),
            });
            files.push({
              name: `${basename}.md`,
              data: materialized.markdown,
            });
            for (const attachment of materialized.attachments) files.push(attachment);
          }
        }

        const zipBlob = await createZipBlob(files);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SyncNos-md-${stamp}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        alert((e as any)?.message ?? String(e ?? t('exportFailedFallback')));
      } finally {
        setExporting(false);
      }
    },
    [items, selectedIds],
  );

  const syncSelectedNotion = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    await startSync('notion', ids);
  }, [selectedIds, startSync]);

  const syncSelectedObsidian = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    await startSync('obsidian', ids);
  }, [selectedIds, startSync]);

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
      alert((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
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
    detailHeaderActions,
    exporting,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
    deleting,
    listSourceFilterKey,
    listSiteFilterKey,
    setListSourceFilterKeyPersistent,
    setListSiteFilterKeyPersistent,
    pendingListLocateId,
    requestListLocate,
    consumeListLocate,
    openConversationExternalById,
    refreshList,
    refreshActiveDetail,
    setActiveId,
    toggleSelected,
    toggleAll,
    clearSelected,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    clearSyncFeedback,
    deleteSelected,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversationsApp() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversationsApp must be used within ConversationsProvider');
  return ctx;
}

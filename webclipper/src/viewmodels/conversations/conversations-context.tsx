import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type {
  Conversation,
  ConversationDetail,
  ConversationListCursor,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListSummary,
} from '@services/conversations/domain/models';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { LIST_SITE_KEY_ALL, LIST_SOURCE_KEY_ALL } from '@services/conversations/domain/list-query';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import {
  deleteConversations,
  findConversationById,
  findConversationBySourceAndKey,
  getConversationListBootstrap,
  getConversationListPage,
  getConversationDetail,
  mergeConversations,
  upsertConversation,
} from '@services/conversations/client/repo';
import { backfillConversationImages } from '@services/conversations/client/repo';
import { migrateArticleCommentsCanonicalUrl } from '@services/comments/client/repo';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { resolveDetailHeaderActions } from '@services/integrations/detail-header-actions';
import { UI_EVENT_TYPES, UI_PORT_NAMES } from '@services/protocols/message-contracts';
import { connectPort } from '@services/shared/ports';
import { cleanTrackingParamsUrl } from '@services/url-cleaning/tracking-param-cleaner';
import { t } from '@i18n';
import {
  useConversationSyncFeedback,
  type ConversationSyncFeedbackState,
} from '@viewmodels/conversations/useConversationSyncFeedback';

const LIST_SOURCE_FILTER_STORAGE_KEY = 'webclipper_conversations_source_filter_key';
const LIST_SITE_FILTER_STORAGE_KEY = 'webclipper_conversations_site_filter_key';
const LIST_SITE_FILTER_ALL_KEY = LIST_SITE_KEY_ALL;
const LIST_BOOTSTRAP_LIMIT = 200;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;
const EMPTY_LIST_SUMMARY: ConversationListSummary = { totalCount: 0, todayCount: 0 };
const EMPTY_LIST_FACETS: ConversationListFacets = { sources: [], sites: [] };

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
  const text = String(raw || '')
    .trim()
    .toLowerCase();
  if (!text) return 'png';
  if (text === 'jpeg') return 'jpg';
  if (text === 'svg+xml') return 'svg';
  if (text === 'x-icon' || text === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(text) ? text : 'png';
}

function inferImageExtFromAsset(asset: { contentType?: string; url?: string }): string {
  const contentType = String(asset.contentType || '')
    .trim()
    .toLowerCase();
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

function canonicalizeHttpUrl(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function resolveConversationSourceType(input: { sourceType?: unknown; source?: unknown; url?: unknown }): string | undefined {
  const explicit = String(input?.sourceType || '')
    .trim()
    .toLowerCase();
  if (explicit) return explicit;

  const source = String(input?.source || '')
    .trim()
    .toLowerCase();
  if (source !== 'web') return undefined;

  return canonicalizeHttpUrl(input?.url) ? 'article' : undefined;
}

function ensureConversationUiShape(conversation: Conversation): Conversation {
  const nextSourceType = resolveConversationSourceType({
    sourceType: (conversation as any)?.sourceType,
    source: (conversation as any)?.source,
    url: (conversation as any)?.url,
  });
  if (!nextSourceType) return conversation;

  const currentSourceType = String((conversation as any)?.sourceType || '')
    .trim()
    .toLowerCase();
  if (currentSourceType === nextSourceType) return conversation;

  return { ...(conversation as any), sourceType: nextSourceType };
}

const URL_EDIT_CANCELLED_ERROR = 'SYNCNOS_URL_EDIT_CANCELLED';

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
  return legacy || LIST_SOURCE_KEY_ALL;
}

function readInitialListSiteFilterKey(): string {
  const raw = readLocalStorageValue(LIST_SITE_FILTER_STORAGE_KEY).trim().toLowerCase();
  return raw || LIST_SITE_FILTER_ALL_KEY;
}

function normalizeListSourceFilterKey(input: unknown): string {
  const sourceKey = String(input || '')
    .trim()
    .toLowerCase();
  return sourceKey || LIST_SOURCE_KEY_ALL;
}

function normalizeListSiteFilterKey(input: unknown): string {
  const siteKey = String(input || '')
    .trim()
    .toLowerCase();
  return siteKey || LIST_SITE_FILTER_ALL_KEY;
}

function resolveEffectiveListSiteFilterKey(sourceKey: string, siteKey: string): string {
  return sourceKey === 'web' ? siteKey : LIST_SITE_FILTER_ALL_KEY;
}

function normalizeConversationListSummary(input: unknown): ConversationListSummary {
  const totalCountRaw = Number((input as any)?.totalCount);
  const todayCountRaw = Number((input as any)?.todayCount);
  const totalCount = Number.isFinite(totalCountRaw) && totalCountRaw > 0 ? Math.floor(totalCountRaw) : 0;
  const todayCount = Number.isFinite(todayCountRaw) && todayCountRaw > 0 ? Math.floor(todayCountRaw) : 0;
  return { totalCount, todayCount };
}

function normalizeConversationFacetList(input: unknown): Array<{ key: string; label: string; count: number }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      const key = String((entry as any)?.key || '')
        .trim()
        .toLowerCase();
      const label = String((entry as any)?.label || '').trim();
      const countRaw = Number((entry as any)?.count);
      const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0;
      if (!key || !label || count <= 0) return null;
      return { key, label, count };
    })
    .filter((entry): entry is { key: string; label: string; count: number } => Boolean(entry));
}

function normalizeConversationListFacets(input: unknown): ConversationListFacets {
  const sources = normalizeConversationFacetList((input as any)?.sources);
  const sites = normalizeConversationFacetList((input as any)?.sites);
  return { sources, sites };
}

function toOpenTargetFromConversation(conversation: Conversation | null | undefined): ConversationListOpenTarget | null {
  if (!conversation) return null;
  const id = Number((conversation as any).id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const source = String((conversation as any).source || '').trim();
  const conversationKey = String((conversation as any).conversationKey || '').trim();
  if (!source || !conversationKey) return null;
  const lastCapturedAt = Number((conversation as any).lastCapturedAt);
  const sourceType = resolveConversationSourceType({
    sourceType: (conversation as any).sourceType,
    source,
    url: (conversation as any).url,
  });
  return {
    id,
    source,
    conversationKey,
    title: String((conversation as any).title || '').trim() || undefined,
    url: String((conversation as any).url || '').trim() || undefined,
    sourceType,
    lastCapturedAt: Number.isFinite(lastCapturedAt) ? lastCapturedAt : 0,
  };
}

function toConversationFromOpenTarget(target: ConversationListOpenTarget): Conversation {
  const source = String(target.source || '').trim();
  const url = String(target.url || '').trim() || undefined;
  const sourceType = resolveConversationSourceType({
    sourceType: target.sourceType,
    source,
    url,
  });
  return {
    id: Number(target.id),
    source,
    conversationKey: String(target.conversationKey || '').trim(),
    title: String(target.title || '').trim() || undefined,
    url,
    sourceType,
    lastCapturedAt: Number.isFinite(Number(target.lastCapturedAt)) ? Number(target.lastCapturedAt) : undefined,
  };
}

function sameOpenTarget(a: ConversationListOpenTarget | null, b: ConversationListOpenTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Number(a.id) === Number(b.id) &&
    String(a.source || '') === String(b.source || '') &&
    String(a.conversationKey || '') === String(b.conversationKey || '') &&
    String(a.title || '') === String(b.title || '') &&
    String(a.url || '') === String(b.url || '') &&
    String(a.sourceType || '') === String(b.sourceType || '') &&
    Number(a.lastCapturedAt || 0) === Number(b.lastCapturedAt || 0)
  );
}

function mergeConversationPageItems(prev: Conversation[], next: Conversation[]): Conversation[] {
  if (!Array.isArray(prev) || !prev.length) return Array.isArray(next) ? next : [];
  if (!Array.isArray(next) || !next.length) return prev;

  const out: Conversation[] = prev.slice();
  const indexById = new Map<number, number>();
  for (let idx = 0; idx < out.length; idx += 1) {
    const id = Number((out[idx] as any)?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    indexById.set(id, idx);
  }

  for (const item of next) {
    const id = Number((item as any)?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, out.length);
      out.push(item);
      continue;
    }
    out[existingIndex] = item;
  }

  return out;
}

type ConversationsAppState = {
  loadingList: boolean;
  loadingInitialList: boolean;
  loadingMoreList: boolean;
  listError: string | null;
  listCursor: ConversationListCursor | null;
  listHasMore: boolean;
  listSummary: ConversationListSummary;
  listFacets: ConversationListFacets;
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
  openConversationExternalByLoc: (input: { source: string; conversationKey: string }) => Promise<void>;
  openConversationExternalBySourceKey: (source: string, conversationKey: string) => Promise<void>;
  openConversationExternalById: (conversationId: number) => Promise<void>;
  loadMoreList: () => Promise<void>;

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

  updateSelectedConversationUrl: (nextUrl: string) => Promise<void>;
  cleanUrlDraft: (rawUrl: string) => Promise<string>;
};

const ConversationsContext = createContext<ConversationsAppState | null>(null);

async function loadDetailFor(id: number): Promise<ConversationDetail> {
  return getConversationDetail(id);
}

export function ConversationsProvider({
  children,
  initialOpenLoc = null,
}: {
  children: React.ReactNode;
  initialOpenLoc?: { source: string; conversationKey: string } | null;
}) {
  const [loadingInitialList, setLoadingInitialList] = useState(false);
  const [loadingMoreList, setLoadingMoreList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listCursor, setListCursor] = useState<ConversationListCursor | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const [listSummary, setListSummary] = useState<ConversationListSummary>(EMPTY_LIST_SUMMARY);
  const [listFacets, setListFacets] = useState<ConversationListFacets>(EMPTY_LIST_FACETS);
  const [items, setItems] = useState<Conversation[]>([]);

  const [bootstrapped, setBootstrapped] = useState(false);
  const didBootstrapRef = useRef(false);

  const activeIdRef = useRef<number | null>(null);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  const setActiveId = useCallback((id: number | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);
  const listRequestSeqRef = useRef(0);
  const openTargetRequestSeqRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const [listSourceFilterKey, setListSourceFilterKey] = useState<string>(() => readInitialListSourceFilterKey());
  const [listSiteFilterKey, setListSiteFilterKey] = useState<string>(() => readInitialListSiteFilterKey());
  const activeConversationSnapshotRef = useRef<ConversationListOpenTarget | null>(null);
  const [activeConversationSnapshot, setActiveConversationSnapshotState] = useState<ConversationListOpenTarget | null>(null);
  const setActiveConversationSnapshot = useCallback((next: ConversationListOpenTarget | null) => {
    activeConversationSnapshotRef.current = next;
    setActiveConversationSnapshotState(next);
  }, []);
  const [pendingListLocateId, setPendingListLocateId] = useState<number | null>(null);
  const pendingListLocateIdRef = useRef<number | null>(null);
  const listFilterScopeRef = useRef<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    feedback: syncFeedback,
    clearFeedback: clearSyncFeedback,
    startSync,
    syncingNotion,
    syncingObsidian,
  } = useConversationSyncFeedback();

  const selectedConversation = useMemo(() => {
    const selectedId = Number(activeId);
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null;

    const loaded = items.find((x) => Number(x.id) === selectedId);
    if (loaded) return ensureConversationUiShape(loaded);

    if (!activeConversationSnapshot || Number(activeConversationSnapshot.id) !== selectedId) return null;
    return toConversationFromOpenTarget(activeConversationSnapshot);
  }, [activeConversationSnapshot, items, activeId]);
  const [detailHeaderActions, setDetailHeaderActions] = useState<DetailHeaderAction[]>([]);

  const setListSourceFilterKeyPersistent = useCallback((next: string) => {
    const value =
      String(next || LIST_SOURCE_KEY_ALL)
        .trim()
        .toLowerCase() || LIST_SOURCE_KEY_ALL;
    setListSourceFilterKey(value);
    writeLocalStorageValue(LIST_SOURCE_FILTER_STORAGE_KEY, value);
  }, []);

  const setListSiteFilterKeyPersistent = useCallback((next: string) => {
    const value =
      String(next || LIST_SITE_FILTER_ALL_KEY)
        .trim()
        .toLowerCase() || LIST_SITE_FILTER_ALL_KEY;
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

  const applyOpenTarget = useCallback(
    (target: ConversationListOpenTarget | null) => {
      if (!target) return;
      const id = Number((target as any).id);
      if (!Number.isFinite(id) || id <= 0) return;
      const normalizedTarget: ConversationListOpenTarget = {
        ...target,
        sourceType: resolveConversationSourceType({
          sourceType: (target as any)?.sourceType,
          source: (target as any)?.source,
          url: (target as any)?.url,
        }),
      };
      setListSourceFilterKeyPersistent(LIST_SOURCE_KEY_ALL);
      setListSiteFilterKeyPersistent(LIST_SITE_FILTER_ALL_KEY);
      setActiveConversationSnapshot(normalizedTarget);
      setActiveId(id);
      requestListLocate(id);
    },
    [
      requestListLocate,
      setActiveConversationSnapshot,
      setActiveId,
      setListSiteFilterKeyPersistent,
      setListSourceFilterKeyPersistent,
    ],
  );

  const openConversationExternalBySourceKey = useCallback(
    async (source: string, conversationKey: string) => {
      const safeSource = String(source || '').trim();
      const safeConversationKey = String(conversationKey || '').trim();
      if (!safeSource || !safeConversationKey) return;

      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const target = await findConversationBySourceAndKey(safeSource, safeConversationKey).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current) return;
      applyOpenTarget(target);
    },
    [applyOpenTarget],
  );

  const openConversationExternalByLoc = useCallback(
    async (input: { source: string; conversationKey: string }) => {
      await openConversationExternalBySourceKey(input?.source, input?.conversationKey);
    },
    [openConversationExternalBySourceKey],
  );

  const openConversationExternalById = useCallback(
    async (conversationId: number) => {
      const id = Number(conversationId);
      if (!Number.isFinite(id) || id <= 0) return;
      const loaded = items.find((conversation) => Number((conversation as any)?.id) === id) || null;
      if (loaded) {
        applyOpenTarget(toOpenTargetFromConversation(loaded));
        return;
      }

      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const target = await findConversationById(id).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current) return;
      applyOpenTarget(target);
    },
    [applyOpenTarget, items],
  );

  const refreshList = useCallback(async () => {
    const sourceKey = normalizeListSourceFilterKey(listSourceFilterKey);
    const rawSiteKey = normalizeListSiteFilterKey(listSiteFilterKey);
    const siteKey = resolveEffectiveListSiteFilterKey(sourceKey, rawSiteKey);

    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;

    setLoadingInitialList(true);
    setLoadingMoreList(false);
    setListError(null);
    setListCursor(null);
    setListHasMore(false);
    try {
      const page = await getConversationListBootstrap(
        { sourceKey, siteKey, limit: LIST_BOOTSTRAP_LIMIT },
        LIST_BOOTSTRAP_LIMIT,
      );
      if (requestSeq !== listRequestSeqRef.current) return;

      const list = Array.isArray(page?.items) ? page.items : [];
      setItems(list);
      setListCursor(page?.cursor ?? null);
      setListHasMore(Boolean(page?.hasMore));
      setListSummary(normalizeConversationListSummary(page?.summary));
      setListFacets(normalizeConversationListFacets(page?.facets));

      const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0));
      setSelectedIds((prev) => prev.filter((id) => ids.has(Number(id))));

      const currentActiveId = Number(activeIdRef.current);
      const requestedId = Number(pendingListLocateIdRef.current);
      const snapshotId = Number((activeConversationSnapshotRef.current as any)?.id);
      const preservingRequestedActive =
        Number.isFinite(currentActiveId) &&
        currentActiveId > 0 &&
        Number.isFinite(requestedId) &&
        requestedId > 0 &&
        requestedId === currentActiveId;
      const preservingSnapshotActive =
        Number.isFinite(currentActiveId) &&
        currentActiveId > 0 &&
        Number.isFinite(snapshotId) &&
        snapshotId > 0 &&
        snapshotId === currentActiveId;
      const shouldPreserveActive =
        Number.isFinite(currentActiveId) &&
        currentActiveId > 0 &&
        (ids.has(currentActiveId) || preservingSnapshotActive || preservingRequestedActive);

      const nextActiveId = shouldPreserveActive
        ? currentActiveId
        : list.length
          ? Number((list[0] as any).id)
          : null;
      setActiveId(nextActiveId);
      if (!shouldPreserveActive) {
        const nextActiveConversation =
          nextActiveId == null
            ? null
            : list.find((conversation) => Number((conversation as any)?.id) === Number(nextActiveId)) || null;
        setActiveConversationSnapshot(toOpenTargetFromConversation(nextActiveConversation));
      }
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setListError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      setListCursor(null);
      setListHasMore(false);
      setListSummary(EMPTY_LIST_SUMMARY);
      setListFacets(EMPTY_LIST_FACETS);
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setLoadingInitialList(false);
      }
    }
  }, [listSiteFilterKey, listSourceFilterKey, setActiveConversationSnapshot, setActiveId]);

  const loadMoreList = useCallback(async () => {
    const cursor = listCursor;
    if (!cursor) return;
    if (!listHasMore) return;
    if (loadingInitialList || loadingMoreList) return;

    const sourceKey = normalizeListSourceFilterKey(listSourceFilterKey);
    const rawSiteKey = normalizeListSiteFilterKey(listSiteFilterKey);
    const siteKey = resolveEffectiveListSiteFilterKey(sourceKey, rawSiteKey);

    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;

    setLoadingMoreList(true);
    setListError(null);
    try {
      const page = await getConversationListPage(
        { sourceKey, siteKey, limit: LIST_BOOTSTRAP_LIMIT },
        cursor,
        LIST_BOOTSTRAP_LIMIT,
      );
      if (requestSeq !== listRequestSeqRef.current) return;

      const pageItems = Array.isArray(page?.items) ? page.items : [];
      setItems((prev) => mergeConversationPageItems(prev, pageItems));
      setListCursor(page?.cursor ?? null);
      setListHasMore(Boolean(page?.hasMore));
      setListSummary(normalizeConversationListSummary(page?.summary));
      setListFacets(normalizeConversationListFacets(page?.facets));
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setListError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setLoadingMoreList(false);
      }
    }
  }, [
    listCursor,
    listHasMore,
    listSiteFilterKey,
    listSourceFilterKey,
    loadingInitialList,
    loadingMoreList,
  ]);

  const updateSelectedConversationUrl = useCallback(
    async (nextUrl: string) => {
      const convo = selectedConversation;
      if (!convo) throw new Error('No conversation selected');

      const nextCanonical = canonicalizeHttpUrl(nextUrl);
      if (!nextCanonical) throw new Error('URL must be an http(s) page');

      const currentCanonical = canonicalizeHttpUrl((convo as any)?.url);
      const sourceType = String((convo as any)?.sourceType || '')
        .trim()
        .toLowerCase();
      const isArticle = sourceType === 'article';

      if (isArticle) {
        const conflict = (Array.isArray(items) ? items : []).find((item) => {
          if (!item) return false;
          const id = Number((item as any).id);
          if (!Number.isFinite(id) || id <= 0) return false;
          if (id === Number((convo as any).id)) return false;
          const itemSourceType = String((item as any).sourceType || '')
            .trim()
            .toLowerCase();
          if (itemSourceType !== 'article') return false;
          const itemCanonical = canonicalizeHttpUrl((item as any).url);
          if (!itemCanonical) return false;
          return itemCanonical === nextCanonical;
        });

        if (conflict) {
          const confirmed =
            typeof globalThis.window?.confirm === 'function'
              ? globalThis.window.confirm(
                  '这个 URL 已存在于另一条文章记录中。继续将会合并评论并去重合并文章记录，是否继续？',
                )
              : true;
          if (!confirmed) throw new Error(URL_EDIT_CANCELLED_ERROR);
        }
      }

      const payload: any = {
        source: (convo as any)?.source,
        conversationKey: (convo as any)?.conversationKey,
        sourceType: (convo as any)?.sourceType || (isArticle ? 'article' : 'chat'),
        url: nextCanonical,
        lastCapturedAt: (convo as any)?.lastCapturedAt,
      };
      await upsertConversation(payload);

      if (isArticle && currentCanonical && currentCanonical !== nextCanonical) {
        await migrateArticleCommentsCanonicalUrl({
          fromCanonicalUrl: currentCanonical,
          toCanonicalUrl: nextCanonical,
          conversationId: Number((convo as any)?.id) || null,
        });
      }

      if (isArticle) {
        const conflict = (Array.isArray(items) ? items : []).find((item) => {
          if (!item) return false;
          const id = Number((item as any).id);
          if (!Number.isFinite(id) || id <= 0) return false;
          if (id === Number((convo as any).id)) return false;
          const itemSourceType = String((item as any).sourceType || '')
            .trim()
            .toLowerCase();
          if (itemSourceType !== 'article') return false;
          const itemCanonical = canonicalizeHttpUrl((item as any).url);
          if (!itemCanonical) return false;
          return itemCanonical === nextCanonical;
        });

        if (conflict) {
          await mergeConversations({
            keepConversationId: Number((convo as any).id),
            removeConversationId: Number((conflict as any).id),
          });
        }
      }
    },
    [items, selectedConversation],
  );

  const cleanUrlDraft = useCallback(async (rawUrl: string) => {
    const canonical = canonicalizeHttpUrl(rawUrl);
    if (!canonical) throw new Error('URL must be an http(s) page');
    try {
      const cleaned = (await cleanTrackingParamsUrl(canonical)) || canonical;
      return canonicalizeHttpUrl(cleaned) || canonical;
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : String(e || 'Failed to clean URL');
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    let cancelled = false;
    void (async () => {
      const safeSource = String(initialOpenLoc?.source || '').trim();
      const safeConversationKey = String(initialOpenLoc?.conversationKey || '').trim();
      if (safeSource && safeConversationKey) {
        await openConversationExternalByLoc({ source: safeSource, conversationKey: safeConversationKey }).catch(() => {});
      }
      if (cancelled) return;
      setBootstrapped(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialOpenLoc, openConversationExternalByLoc]);

  useEffect(() => {
    if (!bootstrapped) return;
    void refreshList();
  }, [bootstrapped, refreshList]);

  useEffect(() => {
    const sourceKey =
      String(listSourceFilterKey || LIST_SOURCE_KEY_ALL)
        .trim()
        .toLowerCase() || LIST_SOURCE_KEY_ALL;
    const siteKey =
      String(listSiteFilterKey || LIST_SITE_FILTER_ALL_KEY)
        .trim()
        .toLowerCase() || LIST_SITE_FILTER_ALL_KEY;
    const scope = `${sourceKey}::${siteKey}`;
    if (listFilterScopeRef.current == null) {
      listFilterScopeRef.current = scope;
      return;
    }
    if (listFilterScopeRef.current === scope) return;
    listFilterScopeRef.current = scope;
    setSelectedIds([]);
  }, [listSiteFilterKey, listSourceFilterKey]);

  useEffect(() => {
    const id = Number(activeId);
    if (!Number.isFinite(id) || id <= 0) {
      setActiveConversationSnapshot(null);
      return;
    }
    const loaded = items.find((conversation) => Number((conversation as any)?.id) === id) || null;
    if (!loaded) return;
    const nextSnapshot = toOpenTargetFromConversation(loaded);
    const prevSnapshot = activeConversationSnapshotRef.current;
    if (sameOpenTarget(prevSnapshot, nextSnapshot)) return;
    setActiveConversationSnapshot(nextSnapshot);
  }, [activeId, items, setActiveConversationSnapshot]);

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

        const isArticle =
          String((selectedConversation as any)?.sourceType || '')
            .trim()
            .toLowerCase() === 'article';
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
  }, [detail, refreshActiveDetail, selectedConversation]);

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
            const d = await getConversationDetail(Number(c.id));
            const basename = buildConversationBasename(c);

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
    loadingList: loadingInitialList,
    loadingInitialList,
    loadingMoreList,
    listError,
    listCursor,
    listHasMore,
    listSummary,
    listFacets,
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
    openConversationExternalByLoc,
    openConversationExternalBySourceKey,
    openConversationExternalById,
    loadMoreList,
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
    updateSelectedConversationUrl,
    cleanUrlDraft,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversationsApp() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversationsApp must be used within ConversationsProvider');
  return ctx;
}

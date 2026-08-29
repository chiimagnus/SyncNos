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
import { formatConversationMarkdownForExternalOutput } from '@services/conversations/external-markdown';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { writeTextToClipboard } from '@services/shared/clipboard';
import {
  deleteConversations,
  findConversationBySourceAndKey,
  getConversationById,
  getConversationListBootstrap,
  getConversationListPage,
  getConversationDetail,
  mergeConversations,
  upsertConversation,
} from '@services/conversations/client/repo';
import { backfillConversationImages } from '@services/conversations/client/repo';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import {
  hasDetailHeaderActionStorageDependencyChange,
  resolveDetailHeaderActions,
} from '@services/integrations/detail-header-actions';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';
import type { DataRevisionScope } from '@services/data-revisions/client';
import { storageOnChanged } from '@services/shared/storage';
import { getEnabledSyncProviders, hasSyncProviderEnabledStorageChange } from '@services/sync/sync-provider-gate';
import type { SyncProvider } from '@services/sync/models';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { t } from '@i18n';
import {
  useConversationSyncFeedback,
  type ConversationSyncFeedbackState,
} from '@viewmodels/conversations/useConversationSyncFeedback';

const LIST_SOURCE_FILTER_STORAGE_KEY = 'webclipper_conversations_source_filter_key';
const LIST_SITE_FILTER_STORAGE_KEY = 'webclipper_conversations_site_filter_key';
const LIST_SITE_FILTER_ALL_KEY = LIST_SITE_KEY_ALL;
const LIST_BOOTSTRAP_LIMIT = 100;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;
const EMPTY_LIST_SUMMARY: ConversationListSummary = { totalCount: 0, todayCount: 0 };
const EMPTY_LIST_FACETS: ConversationListFacets = { sources: [], sites: [] };
const LIST_REVISION_SCOPES: readonly DataRevisionScope[] = ['conversations', 'article_comments'];

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
  return canonicalizeArticleUrl(raw);
}

function resolveConversationSourceType(input: {
  sourceType?: unknown;
  source?: unknown;
  url?: unknown;
}): string | undefined {
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
    return String(globalThis.window?.localStorage?.getItem(key) || '');
  } catch (_e) {
    return '';
  }
}

function writeLocalStorageValue(key: string, value: string | null) {
  try {
    const storage = globalThis.window?.localStorage;
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch (_e) {
    // ignore
  }
}

function readInitialListSourceFilterKey(): string {
  const raw = readLocalStorageValue(LIST_SOURCE_FILTER_STORAGE_KEY).trim().toLowerCase();
  if (raw) return raw;

  return LIST_SOURCE_KEY_ALL;
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

function listFilterScopeKey(sourceKey: string, siteKey: string): string {
  return `${sourceKey}::${siteKey}`;
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
  enabledSyncProviders: SyncProvider[];

  exporting: boolean;
  syncFeedback: ConversationSyncFeedbackState;
  syncingNotion: boolean;
  syncingObsidian: boolean;
  syncingFeishu: boolean;
  syncingGithub: boolean;
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
  openConversationInListScopeByLoc: (input: { source: string; conversationKey: string }) => Promise<void>;
  openConversationInListScopeBySourceKey: (source: string, conversationKey: string) => Promise<void>;
  openConversationInListScopeById: (conversationId: number) => Promise<void>;
  loadMoreList: () => Promise<void>;

  refreshList: () => Promise<void>;
  refreshActiveDetail: () => Promise<void>;
  setActiveId: (id: number | null) => void;
  activateLoadedConversation: (id: number) => void;
  toggleSelected: (id: number) => void;
  toggleAll: (scopeIds?: number[]) => void;
  clearSelected: () => void;

  copyConversationMarkdown: (conversationId: number) => Promise<void>;
  exportSelectedMarkdown: (opts: { mergeSingle: boolean }) => Promise<void>;
  syncSelectedNotion: () => Promise<void>;
  syncSelectedObsidian: () => Promise<void>;
  syncSelectedFeishu: () => Promise<void>;
  syncSelectedGithub: () => Promise<void>;
  clearSyncFeedback: () => void;
  deleteSelected: () => Promise<void>;

  updateSelectedConversationUrl: (nextUrl: string) => Promise<void>;
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
  const [revisionReadinessSettled, setRevisionReadinessSettled] = useState(false);
  const revisionReadinessSettledRef = useRef(false);
  const initialListStartedRef = useRef(false);
  const initialListSettledRef = useRef(false);
  const pendingListRefreshRef = useRef(false);
  const pendingRevisionScopesRef = useRef(new Set<DataRevisionScope>());
  const providerGenerationRef = useRef(0);
  const revisionBatchInFlightRef = useRef(false);
  const pendingConfigHeaderResolveRef = useRef(false);
  const flushPendingRevisionBatchRef = useRef<() => void>(() => {});
  const refreshListRef = useRef<(retryScopes?: readonly DataRevisionScope[]) => Promise<void>>(async () => {});
  const refreshActiveDetailRef = useRef<(retryScopes?: readonly DataRevisionScope[]) => Promise<void>>(async () => {});
  const openConversationExternalByLocRef = useRef<(input: { source: string; conversationKey: string }) => Promise<void>>(
    async () => {},
  );
  const initialOpenLocRef = useRef(initialOpenLoc);
  initialOpenLocRef.current = initialOpenLoc;

  const activeIdRef = useRef<number | null>(null);
  const activeMetadataRequestSeqRef = useRef(0);
  const activeMetadataCommitSeqRef = useRef(0);
  const rehydrateActiveConversationMetadataRef = useRef<() => Promise<boolean>>(async () => true);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  const setActiveId = useCallback((id: number | null) => {
    if (activeIdRef.current === id) return;
    activeMetadataRequestSeqRef.current += 1;
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);
  const listRequestSeqRef = useRef(0);
  const listSuccessRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const detailSuccessRequestSeqRef = useRef(0);
  const openTargetRequestSeqRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRef = useRef<ConversationDetail | null>(null);
  const [detail, setDetailState] = useState<ConversationDetail | null>(null);
  const setDetail = useCallback((next: ConversationDetail | null) => {
    detailRef.current = next;
    setDetailState(next);
  }, []);

  const [listSourceFilterKey, setListSourceFilterKey] = useState<string>(() => readInitialListSourceFilterKey());
  const [listSiteFilterKey, setListSiteFilterKey] = useState<string>(() => readInitialListSiteFilterKey());
  const activeConversationSnapshotRef = useRef<Conversation | null>(null);
  const [activeConversationSnapshot, setActiveConversationSnapshotState] = useState<Conversation | null>(null);
  const setActiveConversationSnapshot = useCallback((next: Conversation | null) => {
    activeConversationSnapshotRef.current = next;
    setActiveConversationSnapshotState(next);
  }, []);
  const [pendingListLocateId, setPendingListLocateId] = useState<number | null>(null);
  const pendingListLocateIdRef = useRef<number | null>(null);
  const listFilterScopeRef = useRef<string | null>(null);
  const listCommittedFilterScopeRef = useRef<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    feedback: syncFeedback,
    clearFeedback: clearSyncFeedback,
    startSync,
    syncingNotion,
    syncingObsidian,
    syncingFeishu,
    syncingGithub,
  } = useConversationSyncFeedback();

  const selectedConversation = useMemo(() => {
    const selectedId = Number(activeId);
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null;

    const loaded = items.find((x) => Number(x.id) === selectedId);
    if (!activeConversationSnapshot || Number(activeConversationSnapshot.id) !== selectedId) return null;
    const commentThreadCount = Number((loaded as any)?.commentThreadCount);
    return ensureConversationUiShape(
      Number.isFinite(commentThreadCount) ? { ...activeConversationSnapshot, commentThreadCount } : activeConversationSnapshot,
    );
  }, [activeConversationSnapshot, items, activeId]);
  const [detailHeaderActions, setDetailHeaderActions] = useState<DetailHeaderAction[]>([]);
  const [detailHeaderActionsRevision, setDetailHeaderActionsRevision] = useState(0);
  const detailHeaderResolveSeqRef = useRef(0);
  const detailHeaderRetryScopesRef = useRef<DataRevisionScope[]>([]);
  const [enabledSyncProviders, setEnabledSyncProviders] = useState<SyncProvider[]>([]);

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

  const clearPendingListLocate = useCallback((conversationId: number) => {
    if (Number(pendingListLocateIdRef.current) !== conversationId) return;
    pendingListLocateIdRef.current = null;
    setPendingListLocateId(null);
  }, []);

  const rehydrateActiveConversationMetadata = useCallback(async (): Promise<boolean> => {
    const id = Number(activeIdRef.current);
    if (!Number.isFinite(id) || id <= 0) return true;

    const requestSeq = activeMetadataRequestSeqRef.current + 1;
    activeMetadataRequestSeqRef.current = requestSeq;
    try {
      const conversation = await getConversationById(id);
      if (requestSeq !== activeMetadataRequestSeqRef.current || Number(activeIdRef.current) !== id) return false;
      if (!conversation) {
        setActiveConversationSnapshot(null);
        clearPendingListLocate(id);
        setActiveId(null);
        return true;
      }
      if (Number(conversation.id) !== id) throw new Error('conversation lookup returned a mismatched id');
      activeMetadataCommitSeqRef.current += 1;
      setActiveConversationSnapshot(conversation);
      return true;
    } catch (_error) {
      if (requestSeq !== activeMetadataRequestSeqRef.current || Number(activeIdRef.current) !== id) return false;
      requestDataRevisionRetry(['conversations']);
      return false;
    }
  }, [clearPendingListLocate, setActiveConversationSnapshot, setActiveId]);
  rehydrateActiveConversationMetadataRef.current = rehydrateActiveConversationMetadata;

  const applyActiveConversation = useCallback(
    (conversation: Conversation | null, options?: { preserveListScope?: boolean }) => {
      if (!conversation) return;
      const id = Number((conversation as any).id);
      if (!Number.isFinite(id) || id <= 0) return;
      const source = String((conversation as any).source || '').trim();
      const conversationKey = String((conversation as any).conversationKey || '').trim();
      if (!source || !conversationKey) return;
      const normalizedConversation: Conversation = {
        ...conversation,
        id,
        source,
        conversationKey,
        sourceType: resolveConversationSourceType({
          sourceType: (conversation as any)?.sourceType,
          source,
          url: (conversation as any)?.url,
        }),
      };
      if (!options?.preserveListScope) {
        setListSourceFilterKeyPersistent(LIST_SOURCE_KEY_ALL);
        setListSiteFilterKeyPersistent(LIST_SITE_FILTER_ALL_KEY);
      }
      setActiveConversationSnapshot(normalizedConversation);
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

  const activateLoadedConversation = useCallback(
    (conversationId: number) => {
      const id = Number(conversationId);
      if (!Number.isFinite(id) || id <= 0 || Number(activeIdRef.current) === id) return;
      const loaded = items.find((conversation) => Number((conversation as any)?.id) === id) || null;
      if (!loaded) return;
      setActiveConversationSnapshot(loaded);
      setActiveId(id);
    },
    [items, setActiveConversationSnapshot, setActiveId],
  );

  const openConversationBySourceKey = useCallback(
    async (source: string, conversationKey: string, options?: { preserveListScope?: boolean }) => {
      const safeSource = String(source || '').trim();
      const safeConversationKey = String(conversationKey || '').trim();
      if (!safeSource || !safeConversationKey) return;

      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const target = await findConversationBySourceAndKey(safeSource, safeConversationKey).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current) return;
      applyActiveConversation(target ? toConversationFromOpenTarget(target) : null, options);
    },
    [applyActiveConversation],
  );

  const openConversationExternalBySourceKey = useCallback(
    async (source: string, conversationKey: string) => {
      await openConversationBySourceKey(source, conversationKey, { preserveListScope: false });
    },
    [openConversationBySourceKey],
  );

  const openConversationExternalByLoc = useCallback(
    async (input: { source: string; conversationKey: string }) => {
      await openConversationExternalBySourceKey(input?.source, input?.conversationKey);
    },
    [openConversationExternalBySourceKey],
  );
  openConversationExternalByLocRef.current = openConversationExternalByLoc;

  const openConversationInListScopeBySourceKey = useCallback(
    async (source: string, conversationKey: string) => {
      await openConversationBySourceKey(source, conversationKey, { preserveListScope: true });
    },
    [openConversationBySourceKey],
  );

  const openConversationInListScopeByLoc = useCallback(
    async (input: { source: string; conversationKey: string }) => {
      await openConversationInListScopeBySourceKey(input?.source, input?.conversationKey);
    },
    [openConversationInListScopeBySourceKey],
  );

  const openConversationExternalById = useCallback(
    async (conversationId: number) => {
      const id = Number(conversationId);
      if (!Number.isFinite(id) || id <= 0) return;
      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const conversation = await getConversationById(id).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current) return;
      applyActiveConversation(conversation, { preserveListScope: false });
    },
    [applyActiveConversation],
  );

  const openConversationInListScopeById = useCallback(
    async (conversationId: number) => {
      const id = Number(conversationId);
      if (!Number.isFinite(id) || id <= 0) return;
      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const conversation = await getConversationById(id).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current) return;
      applyActiveConversation(conversation, { preserveListScope: true });
    },
    [applyActiveConversation],
  );

  const refreshList = useCallback(async (retryScopes: readonly DataRevisionScope[] = LIST_REVISION_SCOPES) => {
    const sourceKey = normalizeListSourceFilterKey(listSourceFilterKey);
    const rawSiteKey = normalizeListSiteFilterKey(listSiteFilterKey);
    const siteKey = resolveEffectiveListSiteFilterKey(sourceKey, rawSiteKey);
    const scope = listFilterScopeKey(sourceKey, siteKey);
    const scopedRetries = retryScopes.filter((retryScope) => LIST_REVISION_SCOPES.includes(retryScope));

    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;
    const activeMetadataRequestSeq = activeMetadataRequestSeqRef.current;
    const activeMetadataCommitSeq = activeMetadataCommitSeqRef.current;

    if (listCommittedFilterScopeRef.current !== scope) {
      listCommittedFilterScopeRef.current = scope;
      setItems([]);
      setListCursor(null);
      setListHasMore(false);
      setListSummary(EMPTY_LIST_SUMMARY);
      setListFacets(EMPTY_LIST_FACETS);
      setSelectedIds([]);
    }
    setLoadingInitialList(true);
    setLoadingMoreList(false);
    setListError(null);
    try {
      const page = await getConversationListBootstrap(
        { sourceKey, siteKey, limit: LIST_BOOTSTRAP_LIMIT },
        LIST_BOOTSTRAP_LIMIT,
      );
      if (requestSeq !== listRequestSeqRef.current) return;

      const list = Array.isArray(page?.items) ? page.items : [];
      listSuccessRequestSeqRef.current = requestSeq;
      listCommittedFilterScopeRef.current = scope;
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

      const nextActiveId = shouldPreserveActive ? currentActiveId : list.length ? Number((list[0] as any).id) : null;
      setActiveId(nextActiveId);
      if (!shouldPreserveActive) {
        const nextActiveConversation =
          nextActiveId == null
            ? null
            : list.find((conversation) => Number((conversation as any)?.id) === Number(nextActiveId)) || null;
        setActiveConversationSnapshot(nextActiveConversation);
      } else if (
        activeMetadataRequestSeq === activeMetadataRequestSeqRef.current &&
        activeMetadataCommitSeq === activeMetadataCommitSeqRef.current &&
        !preservingSnapshotActive
      ) {
        const currentActiveConversation = list.find(
          (conversation) => Number((conversation as any)?.id) === currentActiveId,
        );
        if (currentActiveConversation) setActiveConversationSnapshot(currentActiveConversation);
      }
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setListError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      requestDataRevisionRetry(scopedRetries.length ? scopedRetries : LIST_REVISION_SCOPES);
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setLoadingInitialList(false);
      }
    }
  }, [listSiteFilterKey, listSourceFilterKey, setActiveConversationSnapshot, setActiveId]);
  refreshListRef.current = refreshList;

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
    const activeMetadataRequestSeq = activeMetadataRequestSeqRef.current;
    const activeMetadataCommitSeq = activeMetadataCommitSeqRef.current;

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
      const activeId = Number(activeIdRef.current);
      const snapshotId = Number((activeConversationSnapshotRef.current as any)?.id);
      const activeConversation = pageItems.find((conversation) => Number((conversation as any)?.id) === activeId);
      if (
        activeConversation &&
        snapshotId !== activeId &&
        activeMetadataRequestSeq === activeMetadataRequestSeqRef.current &&
        activeMetadataCommitSeq === activeMetadataCommitSeqRef.current
      ) {
        setActiveConversationSnapshot(activeConversation);
      }
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setListError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      requestDataRevisionRetry(LIST_REVISION_SCOPES);
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setLoadingMoreList(false);
      }
    }
  }, [listCursor, listHasMore, listSiteFilterKey, listSourceFilterKey, loadingInitialList, loadingMoreList]);

  const updateSelectedConversationUrl = useCallback(
    async (nextUrl: string) => {
      const convo = selectedConversation;
      if (!convo) throw new Error('No conversation selected');

      const nextCanonical = canonicalizeHttpUrl(nextUrl);
      if (!nextCanonical) throw new Error('URL must be an http(s) page');

      const sourceType = String((convo as any)?.sourceType || '')
        .trim()
        .toLowerCase();
      const isArticle = sourceType === 'article';

      const conflict = isArticle
        ? (Array.isArray(items) ? items : []).find((item) => {
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
          })
        : undefined;

      if (conflict) {
        const confirmed =
          typeof globalThis.window?.confirm === 'function'
            ? globalThis.window.confirm(
                '这个 URL 已存在于另一条文章记录中。继续将会合并评论并去重合并文章记录，是否继续？',
              )
            : true;
        if (!confirmed) throw new Error(URL_EDIT_CANCELLED_ERROR);

        await mergeConversations({
          keepConversationId: Number((convo as any).id),
          removeConversationId: Number((conflict as any).id),
        });
      }

      const updated = await upsertConversation({
        id: Number((convo as any)?.id),
        source: (convo as any)?.source,
        conversationKey: (convo as any)?.conversationKey,
        sourceType: (convo as any)?.sourceType || (isArticle ? 'article' : 'chat'),
        url: nextCanonical,
      });
      if (Number(activeIdRef.current) === Number(updated?.id)) setActiveConversationSnapshot(updated);
      await refreshList();
    },
    [items, refreshList, selectedConversation, setActiveConversationSnapshot],
  );

  useEffect(() => {
    let disposed = false;
    const generation = providerGenerationRef.current + 1;
    providerGenerationRef.current = generation;

    const flushPendingRevisionBatch = () => {
      if (disposed || providerGenerationRef.current !== generation) return;
      if (!revisionReadinessSettledRef.current || !initialListSettledRef.current || revisionBatchInFlightRef.current) {
        return;
      }
      if (!pendingListRefreshRef.current && !pendingRevisionScopesRef.current.size) return;

      revisionBatchInFlightRef.current = true;
      void (async () => {
        let headerReady = false;
        let headerBlockedByDataFailure = false;
        const headerRetryScopes = new Set<DataRevisionScope>();

        while (!disposed && providerGenerationRef.current === generation) {
          const batchScopes = new Set(pendingRevisionScopesRef.current);
          const forceListRefresh = pendingListRefreshRef.current;
          pendingRevisionScopesRef.current.clear();
          pendingListRefreshRef.current = false;
          if (!batchScopes.size && !forceListRefresh) break;

          const conversationScopeChanged = batchScopes.has('conversations');
          const commentsChanged = batchScopes.has('article_comments');
          const messagesChanged = batchScopes.has('messages');
          const mappingsChanged = batchScopes.has('sync_mappings');
          const headerRelevant = conversationScopeChanged || messagesChanged || mappingsChanged;

          let metadataOk = true;
          let listOk = true;
          let detailOk = true;

          if (conversationScopeChanged) {
            metadataOk = await rehydrateActiveConversationMetadataRef.current();
            if (disposed || providerGenerationRef.current !== generation) return;
          }

          if (conversationScopeChanged || commentsChanged || forceListRefresh) {
            const expectedListSeq = listRequestSeqRef.current + 1;
            const listRetryScopes = LIST_REVISION_SCOPES.filter((scope) => batchScopes.has(scope));
            if (listRetryScopes.length) await refreshListRef.current(listRetryScopes);
            else await refreshListRef.current();
            if (disposed || providerGenerationRef.current !== generation) return;
            listOk =
              listRequestSeqRef.current === expectedListSeq && listSuccessRequestSeqRef.current === expectedListSeq;
          }

          if (messagesChanged) {
            const expectedDetailSeq = detailRequestSeqRef.current + 1;
            await refreshActiveDetailRef.current(['messages']);
            if (disposed || providerGenerationRef.current !== generation) return;
            detailOk =
              detailRequestSeqRef.current === expectedDetailSeq && detailSuccessRequestSeqRef.current === expectedDetailSeq;
          }

          if (headerRelevant) {
            const prerequisitesOk = (!conversationScopeChanged || (metadataOk && listOk)) && (!messagesChanged || detailOk);
            if (prerequisitesOk) {
              headerReady = true;
              headerBlockedByDataFailure = false;
              for (const scope of batchScopes) {
                if (scope === 'conversations' || scope === 'messages' || scope === 'sync_mappings') {
                  headerRetryScopes.add(scope);
                }
              }
            } else {
              headerReady = false;
              headerBlockedByDataFailure = true;
              headerRetryScopes.clear();
            }
          }
        }

        const configResolvePending = pendingConfigHeaderResolveRef.current;
        pendingConfigHeaderResolveRef.current = false;
        revisionBatchInFlightRef.current = false;

        if (headerReady) {
          detailHeaderRetryScopesRef.current = Array.from(headerRetryScopes);
          setDetailHeaderActionsRevision((value) => value + 1);
        } else if (configResolvePending && !headerBlockedByDataFailure) {
          detailHeaderRetryScopesRef.current = [];
          setDetailHeaderActionsRevision((value) => value + 1);
        }

        flushPendingRevisionBatch();
      })().catch(() => {
        revisionBatchInFlightRef.current = false;
        flushPendingRevisionBatch();
      });
    };

    flushPendingRevisionBatchRef.current = flushPendingRevisionBatch;
    const unsubscribe = subscribeDataRevisionChanges((scopes) => {
      const relevantScopes = scopes.filter(
        (scope) =>
          scope === 'conversations' ||
          scope === 'messages' ||
          scope === 'sync_mappings' ||
          scope === 'article_comments',
      );
      if (!relevantScopes.length || disposed || providerGenerationRef.current !== generation) return;

      for (const scope of relevantScopes) pendingRevisionScopesRef.current.add(scope);
      const listChanged = relevantScopes.includes('conversations') || relevantScopes.includes('article_comments');
      const headerChanged =
        relevantScopes.includes('conversations') ||
        relevantScopes.includes('messages') ||
        relevantScopes.includes('sync_mappings');

      if (relevantScopes.includes('conversations')) {
        activeMetadataRequestSeqRef.current += 1;
        openTargetRequestSeqRef.current += 1;
      }
      if (listChanged) listRequestSeqRef.current += 1;
      if (relevantScopes.includes('messages')) detailRequestSeqRef.current += 1;
      if (headerChanged) {
        detailHeaderResolveSeqRef.current += 1;
        detailHeaderRetryScopesRef.current = [];
        setDetailHeaderActions([]);
      }

      flushPendingRevisionBatch();
    });

    void whenDataRevisionObserverReady().then(() => {
      if (disposed || providerGenerationRef.current !== generation) return;
      revisionReadinessSettledRef.current = true;
      setRevisionReadinessSettled(true);
      flushPendingRevisionBatch();
    });

    return () => {
      disposed = true;
      providerGenerationRef.current += 1;
      revisionBatchInFlightRef.current = false;
      flushPendingRevisionBatchRef.current = () => {};
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!revisionReadinessSettled || didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    let cancelled = false;
    void (async () => {
      const safeSource = String(initialOpenLocRef.current?.source || '').trim();
      const safeConversationKey = String(initialOpenLocRef.current?.conversationKey || '').trim();
      if (safeSource && safeConversationKey) {
        await openConversationExternalByLocRef.current({ source: safeSource, conversationKey: safeConversationKey }).catch(
          () => {},
        );
      }
      if (cancelled) return;
      setBootstrapped(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [revisionReadinessSettled]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (initialListStartedRef.current) {
      if (!initialListSettledRef.current) {
        listRequestSeqRef.current += 1;
        pendingListRefreshRef.current = true;
        return;
      }
      void refreshList();
      return;
    }

    initialListStartedRef.current = true;
    let cancelled = false;
    void refreshList().finally(() => {
      if (cancelled) return;
      initialListSettledRef.current = true;
      flushPendingRevisionBatchRef.current();
    });

    return () => {
      cancelled = true;
    };
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

  const refreshActiveDetail = useCallback(
    async (retryScopes: readonly DataRevisionScope[] = []) => {
      const id = Number(activeIdRef.current);
      if (!Number.isFinite(id) || id <= 0) {
        detailRequestSeqRef.current += 1;
        detailSuccessRequestSeqRef.current = detailRequestSeqRef.current;
        setLoadingDetail(false);
        setDetailError(null);
        setDetail(null);
        return;
      }

      const requestSeq = detailRequestSeqRef.current + 1;
      detailRequestSeqRef.current = requestSeq;
      setLoadingDetail(true);
      setDetailError(null);
      if (Number((detailRef.current as any)?.conversationId) !== id) setDetail(null);
      try {
        const d = await loadDetailFor(id);
        if (requestSeq !== detailRequestSeqRef.current || Number(activeIdRef.current) !== id) return;
        const detailId = Number((d as any)?.conversationId);
        if (Number.isFinite(detailId) && detailId > 0 && detailId !== id) return;
        detailSuccessRequestSeqRef.current = requestSeq;
        setDetail(d);
      } catch (e) {
        if (requestSeq !== detailRequestSeqRef.current || Number(activeIdRef.current) !== id) return;
        setDetailError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
        const replayScopes = retryScopes.filter((scope) => scope === 'messages');
        if (replayScopes.length) requestDataRevisionRetry(replayScopes);
      } finally {
        if (requestSeq === detailRequestSeqRef.current && Number(activeIdRef.current) === id) {
          setLoadingDetail(false);
        }
      }
    },
    [setDetail],
  );
  refreshActiveDetailRef.current = refreshActiveDetail;

  useEffect(() => {
    activeIdRef.current = activeId;
    void rehydrateActiveConversationMetadata();
    void refreshActiveDetail();
  }, [activeId, rehydrateActiveConversationMetadata, refreshActiveDetail]);

  useEffect(() => {
    let disposed = false;
    let providerLoadSeq = 0;

    const loadEnabledSyncProviders = async () => {
      const requestSeq = providerLoadSeq + 1;
      providerLoadSeq = requestSeq;
      try {
        const providers = await getEnabledSyncProviders();
        if (disposed || requestSeq !== providerLoadSeq) return;
        setEnabledSyncProviders(providers);
      } catch (_error) {
        // 保留最后一次成功的 provider gate snapshot。
      }
    };

    void loadEnabledSyncProviders();
    const unsubscribe = storageOnChanged((changes: any, areaName: string) => {
      const providerGateChanged = hasSyncProviderEnabledStorageChange(changes, areaName);
      const headerDependencyChanged = hasDetailHeaderActionStorageDependencyChange(changes, areaName);
      if (!providerGateChanged && !headerDependencyChanged) return;

      if (headerDependencyChanged) {
        detailHeaderResolveSeqRef.current += 1;
        detailHeaderRetryScopesRef.current = [];
        setDetailHeaderActions([]);
        if (revisionBatchInFlightRef.current) pendingConfigHeaderResolveRef.current = true;
        else setDetailHeaderActionsRevision((value) => value + 1);
      }
      if (providerGateChanged) void loadEnabledSyncProviders();
    });

    return () => {
      disposed = true;
      providerLoadSeq += 1;
      detailHeaderResolveSeqRef.current += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (revisionBatchInFlightRef.current) return;

    const resolveSeq = detailHeaderResolveSeqRef.current + 1;
    detailHeaderResolveSeqRef.current = resolveSeq;
    const retryScopes = detailHeaderRetryScopesRef.current;
    detailHeaderRetryScopesRef.current = [];

    if (!selectedConversation) {
      setDetailHeaderActions([]);
      return;
    }

    setDetailHeaderActions([]);
    void resolveDetailHeaderActions({ conversation: selectedConversation, detail })
      .then((actions) => {
        if (resolveSeq !== detailHeaderResolveSeqRef.current) return;

        const safeActions = Array.isArray(actions) ? actions : [];

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
                  await backfillConversationImages(conversationId, conversationUrl);
                  await refreshActiveDetail();
                },
              }
            : null;

        setDetailHeaderActions(cacheImagesAction ? [cacheImagesAction, ...safeActions] : safeActions);
      })
      .catch(() => {
        if (resolveSeq !== detailHeaderResolveSeqRef.current) return;
        setDetailHeaderActions([]);
        if (retryScopes.length) requestDataRevisionRetry(retryScopes);
      });

    return () => {
      if (detailHeaderResolveSeqRef.current === resolveSeq) detailHeaderResolveSeqRef.current += 1;
    };
  }, [detail, detailHeaderActionsRevision, refreshActiveDetail, selectedConversation]);

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

  const copyConversationMarkdown = useCallback(async (conversationId: number) => {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');

    const conversation = await getConversationById(id);
    if (!conversation) throw new Error('conversation not found');
    if (Number(conversation.id) !== id) throw new Error('conversation lookup returned a mismatched id');

    const freshDetail = await getConversationDetail(id);
    if (Number((freshDetail as any)?.conversationId) !== id) {
      throw new Error('conversation detail returned a mismatched id');
    }

    const markdown = await formatConversationMarkdownForExternalOutput(conversation, freshDetail);
    if (!(await writeTextToClipboard(markdown))) throw new Error(t('copyFailed'));
  }, []);

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

  const syncSelectedFeishu = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    await startSync('feishu', ids);
  }, [selectedIds, startSync]);

  const syncSelectedGithub = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    await startSync('github', ids);
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
    enabledSyncProviders,
    exporting,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
    syncingFeishu,
    syncingGithub,
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
    openConversationInListScopeByLoc,
    openConversationInListScopeBySourceKey,
    openConversationInListScopeById,
    loadMoreList,
    refreshList,
    refreshActiveDetail,
    setActiveId,
    activateLoadedConversation,
    toggleSelected,
    toggleAll,
    clearSelected,
    copyConversationMarkdown,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    syncSelectedFeishu,
    syncSelectedGithub,
    clearSyncFeedback,
    deleteSelected,
    updateSelectedConversationUrl,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversationsApp() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversationsApp must be used within ConversationsProvider');
  return ctx;
}

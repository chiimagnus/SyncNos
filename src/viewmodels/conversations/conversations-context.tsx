import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type {
  Conversation,
  ConversationDetail,
  ConversationFactsReference,
  ConversationListCursor,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListSummary,
} from '@services/conversations/domain/models';
import {
  LOCAL_DATA_ERROR_CODES,
  type FactsEpoch,
  type LocalDataErrorCode,
  type StableConversationReference,
} from '@services/local-data/contracts';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { LIST_SITE_KEY_ALL, LIST_SOURCE_KEY_ALL } from '@services/conversations/domain/list-query';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import { getConversationImageAsset, type ConversationImageAssetResolver } from '@services/conversations/client/images';
import { createZipBlob } from '@services/sync/backup/zip-utils';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import {
  deleteConversations,
  findConversationBySourceAndKey,
  getConversationListBootstrap,
  getConversationListPage,
  getConversationDetail,
  updateArticleUrl,
} from '@services/conversations/client/repo';
import { backfillConversationImages } from '@services/conversations/client/repo';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { resolveDetailHeaderActions } from '@services/integrations/detail-header-actions';
import { UI_EVENT_TYPES, UI_PORT_NAMES } from '@services/protocols/message-contracts';
import { connectPort } from '@services/shared/ports';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { t } from '@i18n';
import { createLocalFactsRevisionMonitor } from '@services/conversations/client/local-data-revision';
import { useConversationSearchSheet } from '@viewmodels/conversations/useConversationSearchSheet';
import type { ConversationSearchSheetController } from '@viewmodels/conversations/search-sheet-types';
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

function toConversationFactsReference(
  conversation:
    | Readonly<{
        conversationId?: number;
        conversationKey?: string;
        factsEpoch?: FactsEpoch;
        id?: number;
        source?: string;
      }>
    | null
    | undefined,
): ConversationFactsReference | null {
  const source = String(conversation?.source || '').trim();
  const conversationKey = String(conversation?.conversationKey || '').trim();
  const factsEpoch = String(conversation?.factsEpoch || '').trim();
  const conversationId = Number(conversation?.id ?? conversation?.conversationId);
  if (!source || !conversationKey || !factsEpoch) return null;
  return {
    source,
    conversationKey,
    factsEpoch: factsEpoch as FactsEpoch,
    ...(Number.isFinite(conversationId) && conversationId > 0 ? { conversationId } : {}),
  };
}

function toStableConversationReference(
  conversation: Readonly<{ conversationKey?: string; source?: string }> | null | undefined,
): StableConversationReference | null {
  const source = String(conversation?.source || '').trim();
  const conversationKey = String(conversation?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function sameConversationFactsReference(
  a: ConversationFactsReference | null | undefined,
  b: ConversationFactsReference | null | undefined,
): boolean {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a!.source === b!.source &&
    a!.conversationKey === b!.conversationKey &&
    a!.factsEpoch === b!.factsEpoch
  );
}

const URL_EDIT_CANCELLED_ERROR = 'SYNCNOS_URL_EDIT_CANCELLED';

async function materializeSyncnosAssetsForExport(input: {
  attachmentStartIndex?: number;
  markdown: string;
  markdownBasename: string;
  resolveImageAsset: ConversationImageAssetResolver;
}): Promise<{ markdown: string; attachments: Array<{ name: string; data: Blob }> }> {
  const markdown = String(input.markdown || '');
  if (!markdown) return { markdown: '', attachments: [] };

  const basename = String(input.markdownBasename || '').trim() || 'conversation';
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
  let index = Math.max(0, Math.floor(Number(input.attachmentStartIndex) || 0));

  for (const assetId of orderedAssetIds) {
    const asset = await input.resolveImageAsset(assetId);
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

function toOpenTargetFromConversation(
  conversation: Conversation | null | undefined,
): ConversationListOpenTarget | null {
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
    factsEpoch: (conversation as any).factsEpoch,
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
    factsEpoch: target.factsEpoch,
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
    String(a.factsEpoch || '') === String(b.factsEpoch || '') &&
    String(a.title || '') === String(b.title || '') &&
    String(a.url || '') === String(b.url || '') &&
    String(a.sourceType || '') === String(b.sourceType || '') &&
    Number(a.lastCapturedAt || 0) === Number(b.lastCapturedAt || 0)
  );
}

function isStaleFactsError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code || '').trim();
  return code === 'STALE_BACKEND_EPOCH' || code === 'STALE_REFERENCE';
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

type ConversationListFailure = Readonly<{
  code: LocalDataErrorCode | null;
  message: string;
}>;

function conversationListFailure(error: unknown): ConversationListFailure {
  const message = (error as { message?: unknown } | null)?.message;
  const rawCode = (error as { code?: unknown } | null)?.code;
  const code =
    typeof rawCode === 'string' && (LOCAL_DATA_ERROR_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as LocalDataErrorCode)
      : null;
  return Object.freeze({
    code,
    message: typeof message === 'string' && message ? message : String(error ?? t('actionFailedFallback')),
  });
}

type ConversationsAppState = {
  loadingList: boolean;
  loadingInitialList: boolean;
  loadingMoreList: boolean;
  listError: string | null;
  listErrorCode: LocalDataErrorCode | null;
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
  resolveDetailImageAsset: ConversationImageAssetResolver;

  selectedConversation: Conversation | null;
  detailHeaderActions: DetailHeaderAction[];

  exporting: boolean;
  syncFeedback: ConversationSyncFeedbackState;
  syncingNotion: boolean;
  syncingObsidian: boolean;
  syncingFeishu: boolean;
  deleting: boolean;

  listSourceFilterKey: string;
  listSiteFilterKey: string;
  setListSourceFilterKeyPersistent: (next: string) => void;
  setListSiteFilterKeyPersistent: (next: string) => void;

  localSearchSheet: ConversationSearchSheetController;
  openLocalSearch: () => Promise<void>;

  pendingListLocateId: number | null;
  stableIdentityNotice: boolean;
  clearStableIdentityNotice: () => void;
  requestListLocate: (conversationId: number) => void;
  consumeListLocate: () => number | null;
  openConversationExternalByLoc: (input: { source: string; conversationKey: string }) => Promise<void>;
  openConversationExternalBySourceKey: (source: string, conversationKey: string) => Promise<boolean>;
  openConversationInListScopeByLoc: (input: { source: string; conversationKey: string }) => Promise<void>;
  openConversationInListScopeBySourceKey: (source: string, conversationKey: string) => Promise<void>;
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
  syncSelectedFeishu: () => Promise<void>;
  clearSyncFeedback: () => void;
  deleteSelected: () => Promise<void>;

  updateSelectedConversationUrl: (nextUrl: string) => Promise<void>;
  cleanUrlDraft: (rawUrl: string) => Promise<string>;
};

const ConversationsContext = createContext<ConversationsAppState | null>(null);

async function loadDetailFor(reference: ConversationFactsReference): Promise<ConversationDetail> {
  return getConversationDetail(reference);
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
  const [listFailure, setListFailure] = useState<ConversationListFailure | null>(null);
  const listError = listFailure?.message ?? null;
  const listErrorCode = listFailure?.code ?? null;
  const [listCursor, setListCursor] = useState<ConversationListCursor | null>(null);
  const [listFactsEpoch, setListFactsEpoch] = useState<FactsEpoch | null>(null);
  const listFactsEpochRef = useRef<FactsEpoch | null>(null);
  const listFactsRevisionRef = useRef<number | null>(null);
  listFactsEpochRef.current = listFactsEpoch;
  const localRevisionMonitorRef = useRef<ReturnType<typeof createLocalFactsRevisionMonitor> | null>(null);
  if (!localRevisionMonitorRef.current) localRevisionMonitorRef.current = createLocalFactsRevisionMonitor();
  const [listHasMore, setListHasMore] = useState(false);
  const [listSummary, setListSummary] = useState<ConversationListSummary>(EMPTY_LIST_SUMMARY);
  const [listFacets, setListFacets] = useState<ConversationListFacets>(EMPTY_LIST_FACETS);
  const [items, setItems] = useState<Conversation[]>([]);
  const itemsRef = useRef<Conversation[]>([]);
  itemsRef.current = items;

  const [bootstrapped, setBootstrapped] = useState(false);
  const didBootstrapRef = useRef(false);

  const activeIdRef = useRef<number | null>(null);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  const setActiveId = useCallback((id: number | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);
  const listRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const openTargetRequestSeqRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedIdsRef = useRef<number[]>([]);
  selectedIdsRef.current = selectedIds;
  const [stableIdentityNotice, setStableIdentityNotice] = useState(false);
  const clearStableIdentityNotice = useCallback(() => setStableIdentityNotice(false), []);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const [listSourceFilterKey, setListSourceFilterKey] = useState<string>(() => readInitialListSourceFilterKey());
  const [listSiteFilterKey, setListSiteFilterKey] = useState<string>(() => readInitialListSiteFilterKey());
  const localSearchSheet = useConversationSearchSheet({ listSourceFilterKey, listSiteFilterKey });
  const captureLocalSearchRevisionStaleGuard = localSearchSheet.captureRevisionStaleGuard;
  const localSearchFactsRevision = localSearchSheet.result?.factsRevision ?? null;
  const activeConversationSnapshotRef = useRef<ConversationListOpenTarget | null>(null);
  const [activeConversationSnapshot, setActiveConversationSnapshotState] = useState<ConversationListOpenTarget | null>(
    null,
  );
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
    syncingFeishu,
  } = useConversationSyncFeedback();

  const selectedConversation = useMemo(() => {
    const selectedId = Number(activeId);
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null;

    const loaded = items.find((x) => Number(x.id) === selectedId);
    if (loaded) return ensureConversationUiShape(loaded);

    if (!activeConversationSnapshot || Number(activeConversationSnapshot.id) !== selectedId) return null;
    return toConversationFromOpenTarget(activeConversationSnapshot);
  }, [activeConversationSnapshot, items, activeId]);
  const resolveConversationImageAsset = useCallback(
    async (reference: ConversationFactsReference, assetId: number) =>
      await getConversationImageAsset({ reference, assetId }),
    [],
  );
  const resolveDetailImageAsset = useCallback<ConversationImageAssetResolver>(
    async (assetId) => {
      const reference = toConversationFactsReference(detail);
      if (!reference) throw new Error('stale conversation image reference');
      return await resolveConversationImageAsset(reference, assetId);
    },
    [detail, resolveConversationImageAsset],
  );
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
    (target: ConversationListOpenTarget | null, options?: { preserveListScope?: boolean }) => {
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
      if (!options?.preserveListScope) {
        setListSourceFilterKeyPersistent(LIST_SOURCE_KEY_ALL);
        setListSiteFilterKeyPersistent(LIST_SITE_FILTER_ALL_KEY);
      }
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

  const openConversationBySourceKey = useCallback(
    async (source: string, conversationKey: string, options?: { preserveListScope?: boolean }): Promise<boolean> => {
      const safeSource = String(source || '').trim();
      const safeConversationKey = String(conversationKey || '').trim();
      if (!safeSource || !safeConversationKey) return false;

      const requestSeq = openTargetRequestSeqRef.current + 1;
      openTargetRequestSeqRef.current = requestSeq;

      const target = await (
        listFactsEpoch
          ? findConversationBySourceAndKey(safeSource, safeConversationKey, listFactsEpoch)
          : findConversationBySourceAndKey(safeSource, safeConversationKey)
      ).catch(() => null);
      if (requestSeq !== openTargetRequestSeqRef.current || !target) return false;
      applyOpenTarget(target, options);
      return true;
    },
    [applyOpenTarget, listFactsEpoch],
  );

  const openConversationExternalBySourceKey = useCallback(
    async (source: string, conversationKey: string): Promise<boolean> =>
      await openConversationBySourceKey(source, conversationKey, { preserveListScope: false }),
    [openConversationBySourceKey],
  );

  const openConversationExternalByLoc = useCallback(
    async (input: { source: string; conversationKey: string }) => {
      await openConversationExternalBySourceKey(input?.source, input?.conversationKey);
    },
    [openConversationExternalBySourceKey],
  );

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

  const refreshList = useCallback(
    async (options?: {
      migrationReselect?: StableConversationReference | null;
      reconcileStableReferences?: boolean;
    }) => {
      const sourceKey = normalizeListSourceFilterKey(listSourceFilterKey);
      const rawSiteKey = normalizeListSiteFilterKey(listSiteFilterKey);
      const siteKey = resolveEffectiveListSiteFilterKey(sourceKey, rawSiteKey);
      const previousEpoch = listFactsEpochRef.current;
      const previousItems = itemsRef.current;
      const stableForId = (rawId: unknown): StableConversationReference | null => {
        const id = Number(rawId);
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        const loaded = previousItems.find((conversation) => Number(conversation.id) === id) ?? null;
        return (
          toStableConversationReference(loaded) ??
          (Number(activeConversationSnapshotRef.current?.id) === id
            ? toStableConversationReference(activeConversationSnapshotRef.current)
            : null)
        );
      };
      const migrationReselectRequested = Boolean(
        options && Object.prototype.hasOwnProperty.call(options, 'migrationReselect'),
      );
      const activeStableReference = migrationReselectRequested
        ? (options?.migrationReselect ?? null)
        : stableForId(activeIdRef.current);
      const selectedStableReferences = selectedIdsRef.current
        .map(stableForId)
        .filter(Boolean) as StableConversationReference[];
      const selectedStableReferenceCount = selectedIdsRef.current.length;
      const pendingLocateStableReference = stableForId(pendingListLocateIdRef.current);

      const requestSeq = listRequestSeqRef.current + 1;
      listRequestSeqRef.current = requestSeq;

      setLoadingInitialList(true);
      setLoadingMoreList(false);
      setListFailure(null);
      setListCursor(null);
      setListHasMore(false);
      try {
        const page = await getConversationListBootstrap(
          { sourceKey, siteKey, limit: LIST_BOOTSTRAP_LIMIT },
          LIST_BOOTSTRAP_LIMIT,
        );
        if (requestSeq !== listRequestSeqRef.current) return;

        const list = Array.isArray(page?.items) ? page.items : [];
        const factsEpoch = String(page?.factsEpoch || '').trim() as FactsEpoch;
        if (!factsEpoch) throw new Error('missing facts epoch');
        const factsRevision = factsEpoch === 'idb-v1' ? null : Number(page?.factsRevision);
        if (factsEpoch !== 'idb-v1' && (!Number.isSafeInteger(factsRevision) || Number(factsRevision) < 0)) {
          throw new Error('missing facts revision');
        }
        const epochChanged = previousEpoch !== null && previousEpoch !== factsEpoch;
        const reconcileStableReferences = Boolean(
          options?.reconcileStableReferences || migrationReselectRequested || epochChanged,
        );

        const commitListSnapshot = () => {
          setItems(list);
          itemsRef.current = list;
          setListFactsEpoch(factsEpoch);
          listFactsEpochRef.current = factsEpoch;
          listFactsRevisionRef.current = factsRevision;
          setListCursor(page?.cursor ?? null);
          setListHasMore(Boolean(page?.hasMore));
          setListSummary(normalizeConversationListSummary(page?.summary));
          setListFacets(normalizeConversationListFacets(page?.facets));
          localRevisionMonitorRef.current?.setSnapshot({ factsEpoch, factsRevision });
        };

        const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isSafeInteger(x) && x > 0));
        if (reconcileStableReferences) {
          const loadedTargets = new Map<string, ConversationListOpenTarget>();
          for (const conversation of list) {
            const reference = toStableConversationReference(conversation);
            if (reference)
              loadedTargets.set(
                `${reference.source}\u0000${reference.conversationKey}`,
                toOpenTargetFromConversation(conversation)!,
              );
          }
          const resolvedTargets = new Map<string, Promise<ConversationListOpenTarget | null>>();
          const resolveStable = async (
            reference: StableConversationReference | null,
          ): Promise<ConversationListOpenTarget | null> => {
            if (!reference) return null;
            const key = `${reference.source}\u0000${reference.conversationKey}`;
            const loaded = loadedTargets.get(key);
            if (loaded) return loaded;
            let pending = resolvedTargets.get(key);
            if (!pending) {
              pending = findConversationBySourceAndKey(reference.source, reference.conversationKey, factsEpoch).catch(
                () => null,
              );
              resolvedTargets.set(key, pending);
            }
            return await pending;
          };

          const [activeTarget, pendingLocateTarget, ...selectedTargets] = await Promise.all([
            resolveStable(activeStableReference),
            resolveStable(pendingLocateStableReference),
            ...selectedStableReferences.map(resolveStable),
          ]);
          if (requestSeq !== listRequestSeqRef.current) return;

          const nextSelectedIds = Array.from(
            new Set(
              selectedTargets.map((target) => Number(target?.id)).filter((id) => Number.isSafeInteger(id) && id > 0),
            ),
          );
          const nextPendingLocateId = Number(pendingLocateTarget?.id);
          const safePendingLocateId =
            Number.isSafeInteger(nextPendingLocateId) && nextPendingLocateId > 0 ? nextPendingLocateId : null;

          const fallbackTarget = list.length ? toOpenTargetFromConversation(list[0]) : null;
          const nextActiveTarget = activeTarget ?? fallbackTarget;
          const nextActiveId = Number(nextActiveTarget?.id);
          const safeActiveId = Number.isSafeInteger(nextActiveId) && nextActiveId > 0 ? nextActiveId : null;

          // Publish the new list only after every old numeric handle has been translated or dropped.
          commitListSnapshot();
          selectedIdsRef.current = nextSelectedIds;
          setSelectedIds(nextSelectedIds);
          pendingListLocateIdRef.current = safePendingLocateId;
          setPendingListLocateId(safePendingLocateId);
          setActiveId(safeActiveId);
          setActiveConversationSnapshot(nextActiveTarget);

          const identityLost =
            selectedStableReferences.length !== selectedStableReferenceCount ||
            nextSelectedIds.length !== selectedStableReferences.length ||
            Boolean(activeStableReference && !activeTarget) ||
            Boolean(pendingLocateStableReference && !pendingLocateTarget);
          if (identityLost) setStableIdentityNotice(true);
          return;
        }

        commitListSnapshot();
        setSelectedIds((prev) => {
          const next = prev.filter((id) => ids.has(Number(id)));
          selectedIdsRef.current = next;
          return next;
        });
        const currentActiveId = Number(activeIdRef.current);
        const requestedId = Number(pendingListLocateIdRef.current);
        const snapshotId = Number(activeConversationSnapshotRef.current?.id);
        const shouldPreserveActive =
          Number.isSafeInteger(currentActiveId) &&
          currentActiveId > 0 &&
          (ids.has(currentActiveId) || snapshotId === currentActiveId || requestedId === currentActiveId);
        const nextActiveId = shouldPreserveActive ? currentActiveId : list.length ? Number(list[0]?.id) : null;
        setActiveId(Number.isSafeInteger(nextActiveId) && Number(nextActiveId) > 0 ? Number(nextActiveId) : null);
        if (!shouldPreserveActive) {
          const nextActiveConversation =
            nextActiveId == null
              ? null
              : (list.find((conversation) => Number(conversation.id) === Number(nextActiveId)) ?? null);
          setActiveConversationSnapshot(toOpenTargetFromConversation(nextActiveConversation));
        }
      } catch (e) {
        if (requestSeq !== listRequestSeqRef.current) return;
        // A missing/blocked Host is status-only: keep the last safe list and its epoch visible.
        setListFailure(conversationListFailure(e));
      } finally {
        if (requestSeq === listRequestSeqRef.current) setLoadingInitialList(false);
      }
    },
    [listSiteFilterKey, listSourceFilterKey, setActiveConversationSnapshot, setActiveId],
  );

  const loadMoreList = useCallback(async () => {
    const cursor = listCursor;
    const factsEpoch = listFactsEpoch;
    if (!cursor) return;
    if (!factsEpoch) return;
    if (!listHasMore) return;
    if (loadingInitialList || loadingMoreList) return;

    const sourceKey = normalizeListSourceFilterKey(listSourceFilterKey);
    const rawSiteKey = normalizeListSiteFilterKey(listSiteFilterKey);
    const siteKey = resolveEffectiveListSiteFilterKey(sourceKey, rawSiteKey);

    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;

    setLoadingMoreList(true);
    setListFailure(null);
    try {
      const page = await getConversationListPage(
        { sourceKey, siteKey, limit: LIST_BOOTSTRAP_LIMIT },
        cursor,
        factsEpoch,
        LIST_BOOTSTRAP_LIMIT,
      );
      if (requestSeq !== listRequestSeqRef.current) return;

      const pageFactsEpoch = String(page?.factsEpoch || '').trim() as FactsEpoch;
      const pageFactsRevision = pageFactsEpoch === 'idb-v1' ? null : Number(page?.factsRevision);
      const validPageRevision =
        pageFactsEpoch === 'idb-v1' || (Number.isSafeInteger(pageFactsRevision) && Number(pageFactsRevision) >= 0);
      if (
        !pageFactsEpoch ||
        !validPageRevision ||
        pageFactsEpoch !== factsEpoch ||
        pageFactsRevision !== listFactsRevisionRef.current
      ) {
        await refreshList({ reconcileStableReferences: true });
        return;
      }

      const pageItems = Array.isArray(page?.items) ? page.items : [];
      setItems((prev) => {
        const merged = mergeConversationPageItems(prev, pageItems);
        itemsRef.current = merged;
        return merged;
      });
      setListCursor(page?.cursor ?? null);
      setListHasMore(Boolean(page?.hasMore));
      setListSummary(normalizeConversationListSummary(page?.summary));
      setListFacets(normalizeConversationListFacets(page?.facets));
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setListFailure(conversationListFailure(e));
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setLoadingMoreList(false);
      }
    }
  }, [
    listCursor,
    listFactsEpoch,
    listHasMore,
    listSiteFilterKey,
    listSourceFilterKey,
    loadingInitialList,
    loadingMoreList,
    refreshList,
  ]);

  const updateSelectedConversationUrl = useCallback(
    async (nextUrl: string) => {
      const conversation = selectedConversation;
      if (!conversation) throw new Error('No conversation selected');
      const sourceType = String(conversation.sourceType || '')
        .trim()
        .toLowerCase();
      if (sourceType !== 'article') throw new Error('Only article URLs can be edited');

      const fromCanonicalUrl = canonicalizeHttpUrl(conversation.url);
      const toCanonicalUrl = canonicalizeHttpUrl(nextUrl);
      if (!fromCanonicalUrl || !toCanonicalUrl) throw new Error('URL must be an http(s) page');
      if (fromCanonicalUrl === toCanonicalUrl) return;

      const conversationReference = toConversationFactsReference(conversation);
      if (!conversationReference) throw new Error('stale conversation reference');
      const conflict = (Array.isArray(items) ? items : []).find((item) => {
        if (
          !item ||
          String(item.sourceType || '')
            .trim()
            .toLowerCase() !== 'article'
        )
          return false;
        if (
          String(item.source || '').trim() === conversationReference.source &&
          String(item.conversationKey || '').trim() === conversationReference.conversationKey
        ) {
          return false;
        }
        return canonicalizeHttpUrl(item.url) === toCanonicalUrl;
      });

      let confirmedConflict: ConversationFactsReference | undefined;
      if (conflict) {
        const confirmed =
          typeof globalThis.window?.confirm === 'function'
            ? globalThis.window.confirm(
                '这个 URL 已存在于另一条文章记录中。继续将会合并评论并去重合并文章记录，是否继续？',
              )
            : true;
        if (!confirmed) throw new Error(URL_EDIT_CANCELLED_ERROR);
        confirmedConflict = toConversationFactsReference(conflict) ?? undefined;
        if (!confirmedConflict || confirmedConflict.factsEpoch !== conversationReference.factsEpoch) {
          throw new Error('stale conversation reference');
        }
      }

      try {
        await updateArticleUrl({
          conversation: conversationReference,
          ...(confirmedConflict ? { confirmedConflict } : {}),
          fromCanonicalUrl,
          toCanonicalUrl,
        });
      } catch (error) {
        if (isStaleFactsError(error)) await refreshList({ reconcileStableReferences: true }).catch(() => {});
        throw error;
      }
    },
    [items, refreshList, selectedConversation],
  );

  const cleanUrlDraft = useCallback(async (rawUrl: string) => {
    const canonical = canonicalizeHttpUrl(rawUrl);
    if (!canonical) throw new Error('URL must be an http(s) page');
    return canonical;
  }, []);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    let cancelled = false;
    void (async () => {
      const safeSource = String(initialOpenLoc?.source || '').trim();
      const safeConversationKey = String(initialOpenLoc?.conversationKey || '').trim();
      if (safeSource && safeConversationKey) {
        await openConversationExternalByLoc({ source: safeSource, conversationKey: safeConversationKey }).catch(
          () => {},
        );
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
    const reference = toConversationFactsReference(activeConversationSnapshot);
    const snapshotId = Number(activeConversationSnapshot?.id);
    if (!Number.isFinite(id) || id <= 0 || !reference || snapshotId !== id) {
      detailRequestSeqRef.current += 1;
      setLoadingDetail(false);
      setDetailError(null);
      setDetail(null);
      return;
    }

    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    setLoadingDetail(true);
    setDetailError(null);
    setDetail((current) =>
      sameConversationFactsReference(toConversationFactsReference(current), reference) ? current : null,
    );
    const isCurrentReference = () =>
      Number(activeIdRef.current) === id &&
      sameConversationFactsReference(toConversationFactsReference(activeConversationSnapshotRef.current), reference);
    try {
      const d = await loadDetailFor(reference);
      if (requestSeq !== detailRequestSeqRef.current || !isCurrentReference()) return;
      if (!sameConversationFactsReference(toConversationFactsReference(d), reference)) {
        throw new Error('stale conversation detail');
      }
      setDetail(d);
    } catch (e) {
      if (requestSeq !== detailRequestSeqRef.current || !isCurrentReference()) return;
      setDetailError((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      setDetail(null);
    } finally {
      if (requestSeq === detailRequestSeqRef.current && isCurrentReference()) {
        setLoadingDetail(false);
      }
    }
  }, [activeConversationSnapshot]);

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
    let pendingMigrationReselect: StableConversationReference | null | undefined = undefined;

    const flush = async () => {
      if (disposed) return;
      const doList = pendingList;
      const doDetail = pendingDetail;
      const migrationReselect = pendingMigrationReselect;
      pendingList = false;
      pendingDetail = false;
      pendingMigrationReselect = undefined;
      refreshTimer = null;

      if (doList) {
        await refreshList(migrationReselect === undefined ? undefined : { migrationReselect }).catch(() => {});
      }
      // A migration refresh reselects by stable identity and lets the snapshot effect reload detail.
      if (doDetail && migrationReselect === undefined) await refreshActiveDetail().catch(() => {});
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
        } else if (reason === 'localDataMigrationActivated') {
          const active = activeConversationSnapshotRef.current as any;
          const source = String(active?.source || '').trim();
          const conversationKey = String(active?.conversationKey || '').trim();
          pendingMigrationReselect = source && conversationKey ? { source, conversationKey } : null;
          pendingDetail = false;
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
    const monitor = localRevisionMonitorRef.current!;
    if (!String(listFactsEpoch || '').startsWith('native:')) return;

    const refreshStableSnapshot = async () => {
      await refreshList({ reconcileStableReferences: true });
    };
    const probeRevision = () => {
      const staleGuard = captureLocalSearchRevisionStaleGuard();
      const searchFactsRevisionAtProbe = localSearchFactsRevision;
      void monitor
        .checkForExternalChange(refreshStableSnapshot)
        .then((outcome) => {
          const searchRevisionChanged =
            searchFactsRevisionAtProbe !== null &&
            outcome.factsRevision !== null &&
            searchFactsRevisionAtProbe !== outcome.factsRevision;
          if (outcome.revisionChanged || searchRevisionChanged) staleGuard();
        })
        .catch(() => {
          // Focus refresh is best-effort; normal facts operations keep their own epoch/lease safety.
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') probeRevision();
    };

    window.addEventListener('focus', probeRevision);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', probeRevision);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [captureLocalSearchRevisionStaleGuard, listFactsEpoch, localSearchFactsRevision, refreshList]);

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

        const safeActions = Array.isArray(actions) ? actions : [];

        const conversationUrl = String((selectedConversation as any)?.url || '');
        const reference = toConversationFactsReference(selectedConversation);

        const cacheImagesAction: DetailHeaderAction | null = reference
          ? {
              id: 'cache-images',
              label: t('detailHeaderCacheImagesLabel'),
              busyLabel: t('detailHeaderCacheImagesInProgressLabel'),
              showBusyProgress: true,
              kind: 'open-target',
              provider: 'local',
              slot: 'tools',
              afterTriggerLabel: t('detailHeaderCacheImagesDoneLabel'),
              afterTriggerLabelDurationMs: 0,
              onTrigger: async () => {
                await backfillConversationImages({ reference, conversationUrl });
                await refreshActiveDetail();
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
          const attachments: Array<{ name: string; data: Blob }> = [];
          const mergedBaseName = `SyncNos-md-${stamp}`;
          for (const c of selectedConversations) {
            const reference = toConversationFactsReference(c);
            if (!reference) throw new Error('stale conversation reference');
            const d = await getConversationDetail(reference);
            const detailReference = toConversationFactsReference(d);
            if (!detailReference) throw new Error('stale conversation detail reference');
            const materialized = await materializeSyncnosAssetsForExport({
              markdown: formatConversationMarkdown(c, d.messages || []),
              markdownBasename: mergedBaseName,
              attachmentStartIndex: attachments.length,
              resolveImageAsset: async (assetId) => await resolveConversationImageAsset(detailReference, assetId),
            });
            docs.push(materialized.markdown);
            attachments.push(...materialized.attachments);
          }
          const mergedDoc = docs.join('\n---\n\n');
          files.push({ name: `${mergedBaseName}.md`, data: mergedDoc });
          for (const attachment of attachments) files.push(attachment);
        } else {
          for (const c of selectedConversations) {
            const reference = toConversationFactsReference(c);
            if (!reference) throw new Error('stale conversation reference');
            const d = await getConversationDetail(reference);
            const detailReference = toConversationFactsReference(d);
            if (!detailReference) throw new Error('stale conversation detail reference');
            const basename = buildConversationBasename(c);

            const materialized = await materializeSyncnosAssetsForExport({
              markdown: formatConversationMarkdown(c, d.messages || []),
              markdownBasename: basename,
              resolveImageAsset: async (assetId) => await resolveConversationImageAsset(detailReference, assetId),
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
    [items, resolveConversationImageAsset, selectedIds],
  );

  const selectedSyncReferences = useMemo(
    () =>
      selectedIds
        .map((id) => toConversationFactsReference(items.find((conversation) => Number(conversation.id) === Number(id))))
        .filter((reference): reference is ConversationFactsReference => !!reference),
    [items, selectedIds],
  );

  const runSelectedSync = useCallback(
    async (provider: 'notion' | 'obsidian' | 'feishu') => {
      if (selectedSyncReferences.length !== selectedIds.length || !selectedSyncReferences.length) return;
      try {
        await startSync(provider, selectedSyncReferences);
      } catch (error) {
        // The sync feedback hook already surfaces the failure. Refresh stable handles, but never
        // automatically retry a provider side effect after a stale epoch/reference rejection.
        if (isStaleFactsError(error)) await refreshList({ reconcileStableReferences: true }).catch(() => {});
        throw error;
      }
    },
    [refreshList, selectedIds.length, selectedSyncReferences, startSync],
  );

  const syncSelectedNotion = useCallback(async () => await runSelectedSync('notion'), [runSelectedSync]);
  const syncSelectedObsidian = useCallback(async () => await runSelectedSync('obsidian'), [runSelectedSync]);
  const syncSelectedFeishu = useCallback(async () => await runSelectedSync('feishu'), [runSelectedSync]);

  const deleteSelected = useCallback(async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    const references = ids.map((id) =>
      toConversationFactsReference(items.find((conversation) => Number(conversation.id) === Number(id))),
    );
    if (references.some((reference) => !reference)) {
      alert(t('actionFailedFallback'));
      return;
    }

    setDeleting(true);
    try {
      await deleteConversations(references as ConversationFactsReference[]);
      setSelectedIds([]);
      await refreshList();
      await refreshActiveDetail();
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? t('actionFailedFallback')));
      if (isStaleFactsError(e)) await refreshList({ reconcileStableReferences: true }).catch(() => {});
    } finally {
      setDeleting(false);
    }
  }, [items, refreshActiveDetail, refreshList, selectedIds]);

  const value: ConversationsAppState = {
    loadingList: loadingInitialList,
    loadingInitialList,
    loadingMoreList,
    listError,
    listErrorCode,
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
    resolveDetailImageAsset,
    selectedConversation,
    detailHeaderActions,
    exporting,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
    syncingFeishu,
    deleting,
    listSourceFilterKey,
    listSiteFilterKey,
    setListSourceFilterKeyPersistent,
    setListSiteFilterKeyPersistent,
    localSearchSheet,
    openLocalSearch: localSearchSheet.openLocalSearch,
    pendingListLocateId,
    stableIdentityNotice,
    clearStableIdentityNotice,
    requestListLocate,
    consumeListLocate,
    openConversationExternalByLoc,
    openConversationExternalBySourceKey,
    openConversationInListScopeByLoc,
    openConversationInListScopeBySourceKey,
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
    syncSelectedFeishu,
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

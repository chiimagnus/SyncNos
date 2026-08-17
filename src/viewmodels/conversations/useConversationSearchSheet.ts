import { useCallback, useEffect, useRef, useState } from 'react';

import { createConversationSearchClient, type ConversationSearchRequest } from '@services/conversations/client/search';
import { LIST_SITE_KEY_ALL, LIST_SOURCE_KEY_ALL } from '@services/conversations/domain/list-query';
import type { LocalDataSearchResult, LocalDataSearchSort } from '@services/local-data/contracts';
import type {
  ConversationSearchDraft,
  ConversationSearchPreviewState,
  ConversationSearchResultState,
  ConversationSearchSheetController,
  ConversationSearchSheetMode,
} from '@viewmodels/conversations/search-sheet-types';

const EMPTY_PREVIEW: ConversationSearchPreviewState = Object.freeze({
  detail: null,
  error: null,
  loading: false,
  reference: null,
});

function normalizeSourceKey(value: unknown): string {
  return (
    String(value || LIST_SOURCE_KEY_ALL)
      .trim()
      .toLowerCase() || LIST_SOURCE_KEY_ALL
  );
}

function normalizeSiteKey(value: unknown): string {
  return (
    String(value || LIST_SITE_KEY_ALL)
      .trim()
      .toLowerCase() || LIST_SITE_KEY_ALL
  );
}

function effectiveSiteKey(sourceKey: string, siteKey: string): string {
  return sourceKey === LIST_SOURCE_KEY_ALL || sourceKey === 'web' ? siteKey : LIST_SITE_KEY_ALL;
}

function createDraft(sourceKeyValue: unknown, siteKeyValue: unknown): ConversationSearchDraft {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const siteKey = effectiveSiteKey(sourceKey, normalizeSiteKey(siteKeyValue));
  return Object.freeze({ query: '', siteKey, sort: 'best', sourceKey });
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }
  return Boolean(element.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'));
}

function errorCode(error: unknown): string {
  return typeof (error as { code?: unknown } | null)?.code === 'string' ? String((error as { code: string }).code) : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Local search failed');
}

function defaultRequestId(sequence: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return typeof uuid === 'string' && uuid ? uuid : `search:${Date.now()}:${sequence}`;
}

export type ConversationSearchSheetDependencies = Readonly<{
  client?: ReturnType<typeof createConversationSearchClient>;
  createRequestId?: (sequence: number) => string;
}>;

export function useConversationSearchSheet(
  input: Readonly<{
    listSiteFilterKey: string;
    listSourceFilterKey: string;
    dependencies?: ConversationSearchSheetDependencies;
  }>,
): ConversationSearchSheetController {
  const clientRef = useRef<ReturnType<typeof createConversationSearchClient> | null>(null);
  if (!clientRef.current) clientRef.current = input.dependencies?.client ?? createConversationSearchClient();
  const client = clientRef.current;
  const createRequestIdRef = useRef<((sequence: number) => string) | null>(null);
  if (!createRequestIdRef.current) createRequestIdRef.current = input.dependencies?.createRequestId ?? defaultRequestId;
  const initialDraft = createDraft(input.listSourceFilterKey, input.listSiteFilterKey);
  const [mode, setMode] = useState<ConversationSearchSheetMode>('closed');
  const [draft, setDraft] = useState<ConversationSearchDraft>(initialDraft);
  const [result, setResult] = useState<ConversationSearchResultState | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchErrorCode, setSearchErrorCode] = useState<string | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [cursorStale, setCursorStale] = useState(false);
  const [preview, setPreview] = useState<ConversationSearchPreviewState>(EMPTY_PREVIEW);
  const openGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const requestSequenceRef = useRef(0);

  const invalidateSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    previewGenerationRef.current += 1;
    setSearchLoading(false);
    setPreview(EMPTY_PREVIEW);
  }, []);

  const invalidateCursorForDraftChange = useCallback(() => {
    searchGenerationRef.current += 1;
    setSearchLoading(false);
    setSearchError(null);
    setSearchErrorCode(null);
    setCursorStale(false);
    setResult((current) => (current ? Object.freeze({ ...current, cursor: null, hasMore: false }) : current));
  }, []);

  const close = useCallback(() => {
    openGenerationRef.current += 1;
    invalidateSearch();
    setCapabilityLoading(false);
    setMode('closed');
    setDraft(createDraft(input.listSourceFilterKey, input.listSiteFilterKey));
    setResult(null);
    setSearchError(null);
    setSearchErrorCode(null);
    setCursorStale(false);
  }, [input.listSiteFilterKey, input.listSourceFilterKey, invalidateSearch]);

  const openLocalSearch = useCallback(async () => {
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    invalidateSearch();
    setDraft(createDraft(input.listSourceFilterKey, input.listSiteFilterKey));
    setResult(null);
    setSearchError(null);
    setSearchErrorCode(null);
    setCursorStale(false);
    setCapabilityLoading(true);
    try {
      const capability = await client.getCapability();
      if (generation !== openGenerationRef.current) return;
      setMode(capability.searchable ? 'search' : 'disabled');
    } catch (_error) {
      if (generation !== openGenerationRef.current) return;
      setMode('disabled');
    } finally {
      if (generation === openGenerationRef.current) setCapabilityLoading(false);
    }
  }, [client, input.listSiteFilterKey, input.listSourceFilterKey, invalidateSearch]);

  const setQuery = useCallback(
    (query: string) => {
      setDraft((current) => Object.freeze({ ...current, query: String(query ?? '') }));
      invalidateCursorForDraftChange();
    },
    [invalidateCursorForDraftChange],
  );

  const setSourceKey = useCallback(
    (value: string) => {
      setDraft((current) => {
        const sourceKey = normalizeSourceKey(value);
        return Object.freeze({
          ...current,
          sourceKey,
          siteKey: effectiveSiteKey(sourceKey, current.siteKey),
        });
      });
      invalidateCursorForDraftChange();
    },
    [invalidateCursorForDraftChange],
  );

  const setSiteKey = useCallback(
    (value: string) => {
      setDraft((current) =>
        Object.freeze({
          ...current,
          siteKey: effectiveSiteKey(current.sourceKey, normalizeSiteKey(value)),
        }),
      );
      invalidateCursorForDraftChange();
    },
    [invalidateCursorForDraftChange],
  );

  const setSort = useCallback(
    (sort: LocalDataSearchSort) => {
      setDraft((current) => Object.freeze({ ...current, sort: sort === 'recent' ? 'recent' : 'best' }));
      invalidateCursorForDraftChange();
    },
    [invalidateCursorForDraftChange],
  );

  const nextRequestId = useCallback(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    return createRequestIdRef.current!(sequence);
  }, []);

  const submit = useCallback(async () => {
    if (mode !== 'search') return;
    const submitted = Object.freeze({ ...draft });
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    previewGenerationRef.current += 1;
    const requestId = nextRequestId();
    setSearchLoading(true);
    setSearchError(null);
    setSearchErrorCode(null);
    setCursorStale(false);
    setPreview(EMPTY_PREVIEW);
    try {
      const response = await client.search({
        requestId,
        query: submitted.query,
        sourceKey: submitted.sourceKey,
        siteKey: submitted.siteKey,
        sort: submitted.sort,
      });
      if (generation !== searchGenerationRef.current || response.requestId !== requestId) return;
      setResult(
        Object.freeze({
          ...response.page,
          submitted,
        }),
      );
    } catch (error) {
      if (generation !== searchGenerationRef.current) return;
      setSearchError(errorMessage(error));
      setSearchErrorCode(errorCode(error) || null);
      setResult(null);
    } finally {
      if (generation === searchGenerationRef.current) setSearchLoading(false);
    }
  }, [client, draft, mode, nextRequestId]);

  const loadMore = useCallback(async () => {
    const current = result;
    if (mode !== 'search' || searchLoading || !current?.cursor || !current.hasMore) return;
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    const requestId = nextRequestId();
    setSearchLoading(true);
    setSearchError(null);
    setSearchErrorCode(null);
    setCursorStale(false);
    const request: ConversationSearchRequest = {
      requestId,
      query: current.submitted.query,
      sourceKey: current.submitted.sourceKey,
      siteKey: current.submitted.siteKey,
      sort: current.submitted.sort,
      cursor: current.cursor,
    };
    try {
      const response = await client.search(request);
      if (generation !== searchGenerationRef.current || response.requestId !== requestId) return;
      if (response.page.factsRevision !== current.factsRevision) {
        setResult(Object.freeze({ ...current, cursor: null, hasMore: false }));
        setCursorStale(true);
        return;
      }
      setResult(
        Object.freeze({
          ...response.page,
          items: Object.freeze([...current.items, ...response.page.items]),
          submitted: current.submitted,
        }),
      );
    } catch (error) {
      if (generation !== searchGenerationRef.current) return;
      if (errorCode(error) === 'STALE_SEARCH_CURSOR') {
        setResult(Object.freeze({ ...current, cursor: null, hasMore: false }));
        setCursorStale(true);
      } else {
        setSearchError(errorMessage(error));
        setSearchErrorCode(errorCode(error) || null);
      }
    } finally {
      if (generation === searchGenerationRef.current) setSearchLoading(false);
    }
  }, [client, mode, nextRequestId, result, searchLoading]);

  const selectResult = useCallback(
    async (selected: LocalDataSearchResult) => {
      const source = String(selected?.source || '').trim();
      const conversationKey = String(selected?.conversationKey || '').trim();
      if (!source || !conversationKey) return;
      const generation = previewGenerationRef.current + 1;
      previewGenerationRef.current = generation;
      const reference = Object.freeze({ source, conversationKey });
      setPreview(Object.freeze({ detail: null, error: null, loading: true, reference }));
      try {
        const detail = await client.preview(reference);
        if (generation !== previewGenerationRef.current) return;
        setPreview(Object.freeze({ detail, error: null, loading: false, reference }));
      } catch (error) {
        if (generation !== previewGenerationRef.current) return;
        setPreview(Object.freeze({ detail: null, error: errorMessage(error), loading: false, reference }));
      }
    },
    [client],
  );

  const clearPreview = useCallback(() => {
    previewGenerationRef.current += 1;
    setPreview(EMPTY_PREVIEW);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== 'closed' || capabilityLoading) return;
      if (event.defaultPrevented || event.isComposing || event.key.toLowerCase() !== 'k') return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      void openLocalSearch();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [capabilityLoading, mode, openLocalSearch]);

  return Object.freeze({
    mode,
    draft,
    result,
    searchError,
    searchErrorCode,
    searchLoading,
    capabilityLoading,
    cursorStale,
    preview,
    openLocalSearch,
    close,
    setQuery,
    setSourceKey,
    setSiteKey,
    setSort,
    submit,
    loadMore,
    selectResult,
    clearPreview,
  });
}

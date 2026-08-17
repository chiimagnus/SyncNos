import type { ConversationDetailResponse } from '@services/conversations/domain/models';
import type {
  LocalDataSearchFacets,
  LocalDataSearchResult,
  LocalDataSearchSort,
  SearchCursorBinding,
} from '@services/local-data/contracts';

export type ConversationSearchDraft = Readonly<{
  query: string;
  siteKey: string;
  sort: LocalDataSearchSort;
  sourceKey: string;
}>;

export type ConversationSearchSheetMode = 'closed' | 'disabled' | 'search';

export type ConversationSearchResultState = Readonly<{
  cursor: SearchCursorBinding | null;
  factsRevision: number;
  facets: LocalDataSearchFacets;
  hasMore: boolean;
  items: readonly LocalDataSearchResult[];
  submitted: ConversationSearchDraft;
  truncatedByScanLimit: boolean;
}>;

export type ConversationSearchPreviewState = Readonly<{
  detail: ConversationDetailResponse | null;
  error: string | null;
  loading: boolean;
  reference: Readonly<{ conversationKey: string; source: string }> | null;
}>;

export type ConversationSearchSheetController = Readonly<{
  mode: ConversationSearchSheetMode;
  draft: ConversationSearchDraft;
  result: ConversationSearchResultState | null;
  searchError: string | null;
  searchErrorCode: string | null;
  searchLoading: boolean;
  capabilityLoading: boolean;
  cursorStale: boolean;
  preview: ConversationSearchPreviewState;
  openLocalSearch: () => Promise<void>;
  close: () => void;
  setQuery: (query: string) => void;
  setSourceKey: (sourceKey: string) => void;
  setSiteKey: (siteKey: string) => void;
  setSort: (sort: LocalDataSearchSort) => void;
  submit: () => Promise<void>;
  loadMore: () => Promise<void>;
  selectResult: (result: LocalDataSearchResult) => Promise<void>;
  clearPreview: () => void;
  markResultsStale: () => void;
  captureRevisionStaleGuard: () => () => void;
}>;

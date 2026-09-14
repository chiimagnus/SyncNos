import type {
  CommentSidebarComposerAttachment,
  CommentSidebarHostActionCallbacks,
  CommentSidebarHostActions,
  CommentSidebarHostSnapshot,
  CommentSidebarLoadError,
  CommentSidebarLoadStatus,
  CommentSidebarItem,
} from '@services/comments/sidebar/comment-sidebar-state';

export type {
  CommentSaveResult,
  CommentSidebarComposerAttachment,
  CommentSidebarHostActionCallbacks,
  CommentSidebarHostActions,
  CommentSidebarHostSnapshot,
  CommentSidebarLoadError,
  CommentSidebarLoadStatus,
  CommentSidebarItem,
} from '@services/comments/sidebar/comment-sidebar-state';

export type CommentSidebarOpenInput = {
  focusComposer?: boolean;
  source?: string;
};

export type CommentSidebarHost = {
  getSnapshot: () => CommentSidebarHostSnapshot;
  subscribe: (listener: () => void) => () => void;
  actions: CommentSidebarHostActions;
};

export type CommentSidebarPanelLease = {
  dispose: () => void;
};

export type CommentSidebarPanelApi = {
  attachHost: (host: CommentSidebarHost) => CommentSidebarPanelLease;
};

export type CommentSidebarHostUpdate = {
  busy?: boolean;
  comments?: CommentSidebarItem[];
  actionCallbacks?: CommentSidebarHostActionCallbacks;
  loadStatus?: CommentSidebarLoadStatus;
  loadError?: CommentSidebarLoadError | null;
  contextKey?: string;
};

export type CommentSidebarSession = CommentSidebarHost & {
  attachPanel: (panel: CommentSidebarPanelApi) => CommentSidebarPanelLease;
  requestOpen: (input?: CommentSidebarOpenInput) => void;
  requestClose: () => void;
  setComposerAttachment: (input: { quoteText: string; locator?: unknown }) => CommentSidebarComposerAttachment;
  clearComposerAttachment: (expectedSelectionRevision?: number) => boolean;
  updateHost: (input: CommentSidebarHostUpdate) => void;
  dispose: () => void;
};

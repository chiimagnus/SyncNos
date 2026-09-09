import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import type { ArticleCommentLocator } from '@services/comments/domain/models';

export type CommentSidebarItem = ArticleCommentDto;

export type CommentSidebarLoadStatus = 'idle' | 'loading' | 'ready' | 'stale_error';

export type CommentSidebarLoadError = {
  code: string;
  message: string;
};

export type CommentSaveResult = void | boolean | { ok: boolean; createdRootId?: number | null };

export type CommentSidebarComposerSelectionRequest = {
  trigger: 'button' | 'auto';
};

export type CommentSidebarComposerAttachment = {
  displayQuote: string;
  locator: ArticleCommentLocator | null;
  selectionRevision: number;
};

export type CommentSidebarHostSnapshot = {
  open: boolean;
  busy: boolean;
  composerAttachment: CommentSidebarComposerAttachment;
  comments: CommentSidebarItem[];
  focusComposerSignal: number;
  lastOpenSource: string | null;
  contextKey: string;
  loadStatus: CommentSidebarLoadStatus;
  loadError: CommentSidebarLoadError | null;
};

export type CommentSidebarHostActionCallbacks = {
  onSave?: (text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  onReply?: (parentId: number, text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  onDelete?: (id: number) => void | Promise<void>;
  onClose?: () => void;
  onComposerSelectionRequest?: (input: CommentSidebarComposerSelectionRequest) => void | Promise<void>;
  onComposerQuoteClearRequest?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
};

export type CommentSidebarHostActions = {
  save: (text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  reply: (parentId: number, text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  delete: (id: number) => void | Promise<void>;
  close: () => void;
  requestComposerSelection: (input: CommentSidebarComposerSelectionRequest) => void | Promise<void>;
  clearComposerAttachment: () => void | Promise<void>;
  retry: () => void | Promise<void>;
};

export function createCommentSidebarHostSnapshot(): CommentSidebarHostSnapshot {
  return {
    open: false,
    busy: false,
    composerAttachment: { displayQuote: '', locator: null, selectionRevision: 0 },
    comments: [],
    focusComposerSignal: 0,
    lastOpenSource: null,
    contextKey: '',
    loadStatus: 'idle',
    loadError: null,
  };
}

export function createCommentSidebarHostActions(
  readCallbacks: () => CommentSidebarHostActionCallbacks,
): CommentSidebarHostActions {
  const read = () => readCallbacks();
  return Object.freeze({
    save: (text: string) => read().onSave?.(text),
    reply: (parentId: number, text: string) => read().onReply?.(parentId, text),
    delete: (id: number) => read().onDelete?.(id),
    close: () => read().onClose?.(),
    requestComposerSelection: (input: CommentSidebarComposerSelectionRequest) =>
      read().onComposerSelectionRequest?.(input),
    clearComposerAttachment: () => read().onComposerQuoteClearRequest?.(),
    retry: () => read().onRetry?.(),
  });
}

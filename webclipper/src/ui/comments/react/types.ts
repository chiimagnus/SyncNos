import type { CommentSaveResult, ThreadedCommentItem, ThreadedCommentsPanelCommentChatWithConfig } from '../types';

export type ThreadedCommentsPanelComposerSelectionRequest = {
  trigger: 'button' | 'auto';
};

export type ThreadedCommentsPanelHandlers = {
  onSave?: (text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  onReply?: (parentId: number, text: string) => void | Promise<void>;
  onDelete?: (id: number) => void | Promise<void>;
  onClose?: () => void;
  onComposerSelectionRequest?: (input: ThreadedCommentsPanelComposerSelectionRequest) => void | Promise<void>;
};

export type ThreadedCommentsPanelSnapshot = {
  open: boolean;
  busy: boolean;
  quoteText: string;
  comments: ThreadedCommentItem[];
  handlers: ThreadedCommentsPanelHandlers;
  focusComposerSignal: number;
  escapeSignal: number;
  noticeMessage: string;
  noticeVisible: boolean;
  hasFocusWithinPanel: boolean;
  pendingFocusRootId: number | null;
};

export type ThreadedCommentsPanelProps = {
  variant: 'embedded' | 'sidebar';
  fullWidth?: boolean;
  surfaceBg?: string;
  showHeader: boolean;
  showCollapseButton: boolean;
  showHeaderChatWith: boolean;
  snapshot: ThreadedCommentsPanelSnapshot;
  readHandlers?: () => ThreadedCommentsPanelHandlers;
  onRequestClose: () => void;
  onHeaderChatWithRootChange?: (el: HTMLDivElement | null) => void;
  setPendingFocusRootId?: (rootId: number | null) => void;
  locateThreadRoot?: (rootId: number) => Promise<boolean>;
  onLocateFailed?: () => void;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  showNotice?: (message: string) => void;
};

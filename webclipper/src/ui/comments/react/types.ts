import type { CommentSaveResult, ThreadedCommentItem } from '../types';

export type ThreadedCommentsPanelHandlers = {
  onSave?: (text: string) => CommentSaveResult | Promise<CommentSaveResult>;
  onReply?: (parentId: number, text: string) => void | Promise<void>;
  onDelete?: (id: number) => void | Promise<void>;
  onClose?: () => void;
};

export type ThreadedCommentsPanelSnapshot = {
  open: boolean;
  busy: boolean;
  quoteText: string;
  comments: ThreadedCommentItem[];
  handlers: ThreadedCommentsPanelHandlers;
  focusComposerSignal: number;
  noticeMessage: string;
  noticeVisible: boolean;
  hasFocusWithinPanel: boolean;
};

export type ThreadedCommentsPanelProps = {
  variant: 'embedded' | 'sidebar';
  fullWidth?: boolean;
  surfaceBg?: string;
  showHeader: boolean;
  showCollapseButton: boolean;
  snapshot: ThreadedCommentsPanelSnapshot;
  onRequestClose: () => void;
  onHeaderChatWithRootChange?: (el: HTMLDivElement | null) => void;
};

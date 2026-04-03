export type ThreadedCommentItem = {
  id: number;
  parentId: number | null;
  authorName?: string | null;
  createdAt?: number | null;
  quoteText?: string | null;
  commentText: string;
  locator?: unknown | null;
};

export type CommentSaveResult = void | boolean | { ok: boolean; createdRootId?: number | null };

export type ThreadedCommentsPanelApi = {
  open: (input?: { focusComposer?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: ThreadedCommentItem[]) => void;
  setHandlers: (handlers: {
    onSave?: (text: string) => CommentSaveResult | Promise<CommentSaveResult>;
    onReply?: (parentId: number, text: string) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onClose?: () => void;
  }) => void;
};

export type ThreadedCommentsPanelChatWithAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onTrigger?: () => void | string | Promise<void | string>;
};

export type ThreadedCommentsPanelChatWithConfig = {
  resolveActions: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveSingleActionLabel?: () => Promise<string | null>;
};

export type ThreadedCommentsPanelCommentChatWithContext = {
  articleTitle?: string | null;
  canonicalUrl?: string | null;
};

export type ThreadedCommentsPanelCommentChatWithConfig = {
  resolveActions: (
    rootComment: ThreadedCommentItem,
    context: ThreadedCommentsPanelCommentChatWithContext,
    replies?: ThreadedCommentItem[] | null,
  ) => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveContext?: () =>
    | ThreadedCommentsPanelCommentChatWithContext
    | Promise<ThreadedCommentsPanelCommentChatWithContext>;
};

export type MountOptions = {
  overlay?: boolean;
  initiallyOpen?: boolean;
  showHeader?: boolean;
  showCollapseButton?: boolean;
  variant?: 'embedded' | 'sidebar';
  fullWidth?: boolean;
  surfaceBg?: string;
  headerDivider?: boolean;
  dockPage?: boolean;
  locatorEnv?: 'inpage' | 'app' | null;
  getLocatorRoot?: () => Element | null;
  chatWith?: ThreadedCommentsPanelChatWithConfig | null;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
};

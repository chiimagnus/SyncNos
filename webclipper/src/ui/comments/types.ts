export type ThreadedCommentItem = {
  id: number;
  parentId: number | null;
  authorName?: string | null;
  createdAt?: number | null;
  quoteText?: string | null;
  commentText: string;
  locator?: unknown | null;
};

export type ThreadedCommentsPanelApi = {
  open: (input?: { focusComposer?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: ThreadedCommentItem[]) => void;
  setHandlers: (handlers: {
    onSave?: (text: string) => void | boolean | Promise<void | boolean>;
    onReply?: (parentId: number, text: string) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onClose?: () => void;
  }) => void;
};

export type ThreadedCommentsPanelChatWithAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onTrigger?: () => void | Promise<void>;
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
  surfaceBg?: string;
  headerDivider?: boolean;
  dockPage?: boolean;
  locatorEnv?: 'inpage' | 'app' | null;
  getLocatorRoot?: () => Element | null;
  chatWith?: ThreadedCommentsPanelChatWithConfig | null;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
};

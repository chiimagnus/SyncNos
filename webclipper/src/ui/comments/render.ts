import { t } from '@i18n';
import type {
  ThreadedCommentItem,
  ThreadedCommentsPanelChatWithAction,
  ThreadedCommentsPanelCommentChatWithConfig,
  ThreadedCommentsPanelCommentChatWithContext,
} from './types';

type DeleteConfirmLike = {
  isArmed: (key: number) => boolean;
  arm: (key: number) => void;
  clear: () => void;
};

type ReplySendButton = HTMLButtonElement & {
  __webclipperTextValue?: () => string;
};

type RenderThreadedCommentsOptions = {
  items: ThreadedCommentItem[];
  threadsEl: HTMLElement;
  emptyEl: HTMLElement;
  variant: 'embedded' | 'sidebar';
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  onBusyChanged: () => void;
  onDelete?: (id: number) => void | Promise<void>;
  onReply?: (parentId: number, text: string) => void | Promise<void>;
  deleteConfirm: DeleteConfirmLike;
  shouldIgnoreLocateClick: (target: EventTarget | null) => boolean;
  locateThreadRoot: (root: ThreadedCommentItem) => Promise<boolean>;
  onLocateFailed: () => void;
  formatTime: (ts: number | null | undefined) => string;
  autosizeTextarea: (textarea: HTMLTextAreaElement | null | undefined) => void;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  showNotice?: (message: string) => void;
};

const COMMENT_CHAT_WITH_ROOT_SELECTOR = '.webclipper-inpage-comments-panel__comment-chatwith';
const COMMENT_CHAT_WITH_TRIGGER_SELECTOR = '.webclipper-inpage-comments-panel__comment-chatwith-trigger';
const COMMENT_CHAT_WITH_MENU_SELECTOR = '.webclipper-inpage-comments-panel__comment-chatwith-menu';

function compareCommentTimeDesc(a: ThreadedCommentItem, b: ThreadedCommentItem): number {
  const ta = Number(a?.createdAt) || 0;
  const tb = Number(b?.createdAt) || 0;
  if (tb !== ta) return tb - ta;
  const ia = Number(a?.id) || 0;
  const ib = Number(b?.id) || 0;
  return ib - ia;
}

function setPanelTooltip(el: HTMLElement, label: string) {
  const text = String(label || '').trim();
  if (!text) {
    el.removeAttribute('data-webclipper-tooltip');
    return;
  }
  el.setAttribute('data-webclipper-tooltip', text);
}

function normalizeChatWithActions(input: unknown): ThreadedCommentsPanelChatWithAction[] {
  if (!Array.isArray(input)) return [];
  const out: ThreadedCommentsPanelChatWithAction[] = [];
  for (const item of input) {
    const candidate = item as Partial<ThreadedCommentsPanelChatWithAction> | null;
    const id = String(candidate?.id || '').trim();
    const label = String(candidate?.label || '').trim();
    const onTrigger = candidate?.onTrigger;
    if (!id || !label || typeof onTrigger !== 'function') continue;
    out.push({
      id,
      label,
      onTrigger,
      disabled: Boolean(candidate?.disabled),
    });
  }
  return out;
}

function normalizeCommentChatWithContext(input: unknown): ThreadedCommentsPanelCommentChatWithContext {
  const raw = (input || {}) as Partial<ThreadedCommentsPanelCommentChatWithContext>;
  return {
    articleTitle: String(raw.articleTitle || '').trim(),
    canonicalUrl: String(raw.canonicalUrl || '').trim(),
  };
}

function setCommentChatWithMenuOpen(root: HTMLElement, open: boolean) {
  const trigger = root.querySelector(COMMENT_CHAT_WITH_TRIGGER_SELECTOR) as HTMLButtonElement | null;
  const menu = root.querySelector(COMMENT_CHAT_WITH_MENU_SELECTOR) as HTMLElement | null;
  root.toggleAttribute('data-open', open);
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (menu) menu.hidden = !open;
}

function isCommentChatWithMenuOpen(root: HTMLElement): boolean {
  const menu = root.querySelector(COMMENT_CHAT_WITH_MENU_SELECTOR) as HTMLElement | null;
  return Boolean(menu && !menu.hidden);
}

export function closeThreadCommentChatWithMenus(threadsRoot: ParentNode, keepWithin?: Element | null): boolean {
  const roots = Array.from(
    (
      threadsRoot as ParentNode & { querySelectorAll?: (selectors: string) => NodeListOf<HTMLElement> }
    ).querySelectorAll?.(COMMENT_CHAT_WITH_ROOT_SELECTOR) || [],
  ) as HTMLElement[];
  let closed = false;
  for (const root of roots) {
    if (keepWithin && root.contains(keepWithin)) continue;
    if (!isCommentChatWithMenuOpen(root)) continue;
    setCommentChatWithMenuOpen(root, false);
    closed = true;
  }
  return closed;
}

export function closeThreadCommentChatWithMenuOnEscape(threadsRoot: ParentNode): boolean {
  return closeThreadCommentChatWithMenus(threadsRoot, null);
}

export function renderThreadedComments(options: RenderThreadedCommentsOptions) {
  const {
    items,
    threadsEl,
    emptyEl,
    variant,
    isBusy,
    setBusy,
    onBusyChanged,
    onDelete,
    onReply,
    deleteConfirm,
    shouldIgnoreLocateClick,
    locateThreadRoot,
    onLocateFailed,
    formatTime,
    autosizeTextarea,
    commentChatWith,
    showNotice,
  } = options;

  threadsEl.textContent = '';
  deleteConfirm.clear();

  const normalized = (Array.isArray(items) ? items : []).filter((item) => Number.isFinite(Number(item?.id)));
  if (!normalized.length) {
    threadsEl.appendChild(emptyEl);
    onBusyChanged();
    return;
  }

  const roots = normalized.filter((item) => !item.parentId).sort(compareCommentTimeDesc);
  const repliesByRoot = new Map<number, ThreadedCommentItem[]>();
  for (const item of normalized) {
    if (!item.parentId) continue;
    const rootId = Number(item.parentId);
    const list = repliesByRoot.get(rootId) || [];
    list.push(item);
    repliesByRoot.set(rootId, list);
  }

  for (const [rootId, list] of repliesByRoot) {
    repliesByRoot.set(rootId, list.sort(compareCommentTimeDesc));
  }

  for (const root of roots) {
    const rootId = Number(root.id);
    const thread = document.createElement('div');
    thread.className = 'webclipper-inpage-comments-panel__thread';
    threadsEl.appendChild(thread);

    const quoteValue = String(root?.quoteText || '').trim();
    if (quoteValue) {
      const quote = document.createElement('div');
      quote.className = 'webclipper-inpage-comments-panel__thread-quote';
      thread.appendChild(quote);

      const quoteText = document.createElement('div');
      quoteText.className = 'webclipper-inpage-comments-panel__thread-quote-text';
      quoteText.textContent = quoteValue;
      quote.appendChild(quoteText);

      if (variant === 'sidebar') {
        quote.addEventListener('click', (event) => {
          if (isBusy()) return;
          if (shouldIgnoreLocateClick(event.target)) return;
          void (async () => {
            const ok = await locateThreadRoot(root);
            if (!ok) onLocateFailed();
          })();
        });
      }
    }

    const comment = document.createElement('div');
    comment.className = 'webclipper-inpage-comments-panel__comment';
    thread.appendChild(comment);

    const commentHeader = document.createElement('div');
    commentHeader.className = 'webclipper-inpage-comments-panel__comment-header';
    comment.appendChild(commentHeader);

    const commentAvatar = document.createElement('div');
    commentAvatar.className = 'webclipper-inpage-comments-panel__avatar';
    commentAvatar.textContent = 'You';
    commentHeader.appendChild(commentAvatar);

    const commentMeta = document.createElement('div');
    commentMeta.className = 'webclipper-inpage-comments-panel__comment-meta';
    commentHeader.appendChild(commentMeta);

    const commentAuthor = document.createElement('div');
    commentAuthor.className = 'webclipper-inpage-comments-panel__comment-author';
    commentAuthor.textContent = String(root?.authorName || 'You');
    commentMeta.appendChild(commentAuthor);

    const commentTime = document.createElement('div');
    commentTime.className = 'webclipper-inpage-comments-panel__comment-time';
    commentTime.textContent = formatTime(root?.createdAt ?? null);
    commentMeta.appendChild(commentTime);

    const commentActions = document.createElement('div');
    commentActions.className = 'webclipper-inpage-comments-panel__comment-actions';
    commentHeader.appendChild(commentActions);

    const deleteButton = document.createElement('button');
    deleteButton.className =
      'webclipper-inpage-comments-panel__icon-btn webclipper-btn webclipper-btn--danger-tint webclipper-btn--icon';
    deleteButton.type = 'button';
    deleteButton.setAttribute('data-webclipper-comment-delete-id', String(Number(root?.id) || ''));
    deleteButton.setAttribute('aria-label', t('deleteButton'));
    setPanelTooltip(deleteButton, t('tooltipDeleteCommentDetailed'));
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', async () => {
      if (isBusy()) return;
      const id = Number(root?.id);
      if (!Number.isFinite(id) || id <= 0) return;
      if (!deleteConfirm.isArmed(id)) {
        deleteConfirm.arm(id);
        return;
      }
      deleteConfirm.clear();
      if (typeof onDelete !== 'function') return;
      try {
        setBusy(true);
        onBusyChanged();
        await onDelete(id);
      } finally {
        setBusy(false);
        onBusyChanged();
      }
    });
    commentActions.appendChild(deleteButton);

    const replies = repliesByRoot.get(rootId) || [];

    if (commentChatWith) {
      const chatWithWrap = document.createElement('div');
      chatWithWrap.className =
        'webclipper-inpage-comments-panel__comment-chatwith webclipper-inpage-comments-panel__chatwith';
      commentActions.appendChild(chatWithWrap);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className =
        'webclipper-inpage-comments-panel__comment-chatwith-trigger webclipper-inpage-comments-panel__chatwith-trigger webclipper-btn webclipper-btn--tone-muted';
      trigger.textContent = t('detailHeaderChatWithMenuLabel') || 'Chat with...';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      const hasCommentText = String(root?.commentText || '').trim().length > 0;
      trigger.setAttribute('data-base-disabled', hasCommentText ? '0' : '1');
      trigger.disabled = isBusy() || !hasCommentText;
      chatWithWrap.appendChild(trigger);

      const menu = document.createElement('div');
      menu.className =
        'webclipper-inpage-comments-panel__comment-chatwith-menu webclipper-inpage-comments-panel__chatwith-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', t('detailHeaderChatWithMenuAria'));
      menu.hidden = true;
      chatWithWrap.appendChild(menu);

      const menuBody = document.createElement('div');
      menuBody.className =
        'webclipper-inpage-comments-panel__comment-chatwith-menu-body webclipper-inpage-comments-panel__chatwith-menu-body';
      menu.appendChild(menuBody);

      const defaultLabel = t('detailHeaderChatWithMenuLabel') || 'Chat with...';
      let loading = false;
      let requestId = 0;

      const applyTriggerLabel = (label: string, hasMenu: boolean) => {
        trigger.textContent = String(label || '').trim() || defaultLabel;
        if (hasMenu) {
          trigger.setAttribute('aria-haspopup', 'menu');
          return;
        }
        trigger.removeAttribute('aria-haspopup');
      };

      const runAction = (action: ThreadedCommentsPanelChatWithAction | null | undefined) => {
        if (!action || action.disabled) return;
        closeThreadCommentChatWithMenus(threadsEl, null);
        void Promise.resolve()
          .then(() => action.onTrigger?.())
          .then((maybeMessage) => {
            const message = String(maybeMessage || '').trim();
            if (message) showNotice?.(message);
          })
          .catch((error) => {
            const message =
              error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
            showNotice?.(message);
          });
      };

      const renderMenuActions = (actions: ThreadedCommentsPanelChatWithAction[]) => {
        menuBody.textContent = '';
        for (const action of actions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className =
            'webclipper-inpage-comments-panel__comment-chatwith-menu-item webclipper-btn webclipper-btn--menu-item';
          button.textContent = action.label;
          button.setAttribute('data-action-disabled', action.disabled ? '1' : '0');
          button.disabled = isBusy() || Boolean(action.disabled);
          button.addEventListener('click', () => {
            runAction(action);
          });
          menuBody.appendChild(button);
        }
      };

      trigger.addEventListener('click', () => {
        if (isBusy() || !hasCommentText) return;
        if (loading) return;
        if (isCommentChatWithMenuOpen(chatWithWrap)) {
          setCommentChatWithMenuOpen(chatWithWrap, false);
          return;
        }

        closeThreadCommentChatWithMenus(threadsEl, trigger);
        loading = true;
        requestId += 1;
        const currentRequestId = requestId;

        void Promise.resolve(commentChatWith.resolveContext?.())
          .then((context) =>
            commentChatWith.resolveActions(root, normalizeCommentChatWithContext(context || ({} as any)), replies),
          )
          .then((items) => {
            if (!chatWithWrap.isConnected) return;
            if (currentRequestId !== requestId) return;

            const actions = normalizeChatWithActions(items);
            if (!actions.length) {
              applyTriggerLabel(defaultLabel, true);
              showNotice?.('No AI platforms enabled');
              return;
            }

            if (actions.length === 1) {
              applyTriggerLabel(actions[0].label, false);
              runAction(actions[0]);
              return;
            }

            applyTriggerLabel(defaultLabel, true);
            renderMenuActions(actions);
            setCommentChatWithMenuOpen(chatWithWrap, true);
          })
          .catch((error) => {
            if (!chatWithWrap.isConnected) return;
            if (currentRequestId !== requestId) return;
            const message =
              error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
            showNotice?.(message);
          })
          .finally(() => {
            if (!chatWithWrap.isConnected) return;
            if (currentRequestId !== requestId) return;
            loading = false;
        });
      });
    }

    const commentBody = document.createElement('div');
    commentBody.className = 'webclipper-inpage-comments-panel__comment-body';
    commentBody.textContent = String(root?.commentText || '');
    comment.appendChild(commentBody);

    if (variant === 'sidebar') {
      comment.addEventListener('click', (event) => {
        if (isBusy()) return;
        if (shouldIgnoreLocateClick(event.target)) return;
        void (async () => {
          const ok = await locateThreadRoot(root);
          if (!ok) onLocateFailed();
        })();
      });
    }

    if (replies.length) {
      const repliesWrap = document.createElement('div');
      repliesWrap.className = 'webclipper-inpage-comments-panel__replies';
      thread.appendChild(repliesWrap);

      for (const reply of replies) {
        const replyRow = document.createElement('div');
        replyRow.className = 'webclipper-inpage-comments-panel__reply';
        repliesWrap.appendChild(replyRow);

        const replyHeader = document.createElement('div');
        replyHeader.className = 'webclipper-inpage-comments-panel__reply-header';
        replyRow.appendChild(replyHeader);

        const replyAvatar = document.createElement('div');
        replyAvatar.className = 'webclipper-inpage-comments-panel__avatar is-small';
        replyAvatar.textContent = 'You';
        replyHeader.appendChild(replyAvatar);

        const replyMeta = document.createElement('div');
        replyMeta.className = 'webclipper-inpage-comments-panel__reply-meta';
        replyHeader.appendChild(replyMeta);

        const replyAuthor = document.createElement('div');
        replyAuthor.className = 'webclipper-inpage-comments-panel__comment-author';
        replyAuthor.textContent = String(reply?.authorName || 'You');
        replyMeta.appendChild(replyAuthor);

        const replyTime = document.createElement('div');
        replyTime.className = 'webclipper-inpage-comments-panel__comment-time';
        replyTime.textContent = formatTime(reply?.createdAt ?? null);
        replyMeta.appendChild(replyTime);

        const replyActions = document.createElement('div');
        replyActions.className = 'webclipper-inpage-comments-panel__comment-actions';
        replyHeader.appendChild(replyActions);

        const replyDeleteButton = document.createElement('button');
        replyDeleteButton.className =
          'webclipper-inpage-comments-panel__icon-btn webclipper-btn webclipper-btn--danger-tint webclipper-btn--icon';
        replyDeleteButton.type = 'button';
        replyDeleteButton.setAttribute('data-webclipper-comment-delete-id', String(Number(reply?.id) || ''));
        replyDeleteButton.setAttribute('aria-label', t('deleteButton'));
        setPanelTooltip(replyDeleteButton, t('tooltipDeleteCommentDetailed'));
        replyDeleteButton.textContent = '×';
        replyDeleteButton.addEventListener('click', async () => {
          if (isBusy()) return;
          const id = Number(reply?.id);
          if (!Number.isFinite(id) || id <= 0) return;
          if (!deleteConfirm.isArmed(id)) {
            deleteConfirm.arm(id);
            return;
          }
          deleteConfirm.clear();
          if (typeof onDelete !== 'function') return;
          try {
            setBusy(true);
            onBusyChanged();
            await onDelete(id);
          } finally {
            setBusy(false);
            onBusyChanged();
          }
        });
        replyActions.appendChild(replyDeleteButton);

        const replyBody = document.createElement('div');
        replyBody.className = 'webclipper-inpage-comments-panel__comment-body is-reply';
        replyBody.textContent = String(reply?.commentText || '');
        replyRow.appendChild(replyBody);
      }
    }

    const replyComposer = document.createElement('div');
    replyComposer.className = 'webclipper-inpage-comments-panel__reply-composer';
    thread.appendChild(replyComposer);

    const replyTextarea = document.createElement('textarea');
    replyTextarea.className = 'webclipper-inpage-comments-panel__reply-textarea';
    replyTextarea.placeholder = 'Reply…';
    replyTextarea.rows = 1;
    replyComposer.appendChild(replyTextarea);

    const replySend = document.createElement('button') as ReplySendButton;
    replySend.className = 'webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--icon';
    replySend.type = 'button';
    const replyLabel = t('tooltipReplySendDetailed');
    replySend.setAttribute('aria-label', replyLabel);
    setPanelTooltip(replySend, replyLabel);
    replySend.textContent = '↑';
    replyComposer.appendChild(replySend);

    replySend.__webclipperTextValue = () => String(replyTextarea.value || '');

    autosizeTextarea(replyTextarea);
    replyTextarea.addEventListener('input', () => {
      autosizeTextarea(replyTextarea);
      onBusyChanged();
    });
    const submitReply = async () => {
      if (isBusy()) return;
      const text = String(replyTextarea.value || '').trim();
      if (!text) return;
      if (typeof onReply !== 'function') return;
      try {
        setBusy(true);
        onBusyChanged();
        await onReply(rootId, text);
        replyTextarea.value = '';
        autosizeTextarea(replyTextarea);
      } finally {
        setBusy(false);
        onBusyChanged();
      }
    };

    replyTextarea.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key !== 'Enter') return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      void submitReply();
    });

    replySend.addEventListener('click', () => {
      void submitReply();
    });
  }

  onBusyChanged();
}

import { t } from '@i18n';
import type { ThreadedCommentItem } from './types';

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
};

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
    setPanelTooltip(deleteButton, t('deleteButton'));
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

    const replies = repliesByRoot.get(rootId) || [];
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
        setPanelTooltip(replyDeleteButton, t('deleteButton'));
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
    replySend.setAttribute('aria-label', 'Reply');
    setPanelTooltip(replySend, 'Reply');
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

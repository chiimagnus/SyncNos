import inpageCommentsPanelCssRaw from '../styles/inpage-comments-panel.css?raw';

export type InpageCommentItem = {
  id: number;
  parentId: number | null;
  authorName?: string | null;
  createdAt?: number | null;
  quoteText?: string | null;
  quoteContext?: any;
  commentText: string;
};

export type InpageCommentsPanelApi = {
  open: (input?: { focusEditor?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: InpageCommentItem[]) => void;
  setHandlers: (handlers: {
    onSave?: (text: string) => void | Promise<void>;
    onReply?: (parentId: number, text: string) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onLocate?: (item: InpageCommentItem) => void | Promise<void>;
  }) => void;
  setTitle: (title: string) => void;
};

const PANEL_ID = 'webclipper-inpage-comments-panel';
const PANEL_SHADOW_CSS = String(inpageCommentsPanelCssRaw || '');

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function formatTime(ts: number | null | undefined): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    return new Date(t).toLocaleString();
  } catch (_e) {
    return '';
  }
}

function ensurePanelElement(): HTMLElement {
  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing) return existing;

  const el = document.createElement('webclipper-inpage-comments-panel');
  el.id = PANEL_ID;
  applyPanelHostLayoutStyles(el as any);
  setImportantStyle(el as any, 'display', 'none');

  const shadow = el.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_SHADOW_CSS;
  shadow.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'webclipper-inpage-comments-panel__backdrop';
  backdrop.addEventListener('click', () => {
    apiRef.close();
  });
  shadow.appendChild(backdrop);

  const surface = document.createElement('div');
  surface.className = 'webclipper-inpage-comments-panel__surface';
  shadow.appendChild(surface);

  const header = document.createElement('div');
  header.className = 'webclipper-inpage-comments-panel__header';
  surface.appendChild(header);

  const title = document.createElement('div');
  title.className = 'webclipper-inpage-comments-panel__title';
  title.textContent = 'Comments';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'webclipper-inpage-comments-panel__close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => apiRef.close());
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'webclipper-inpage-comments-panel__body';
  surface.appendChild(body);

  const quote = document.createElement('div');
  quote.className = 'webclipper-inpage-comments-panel__quote';
  body.appendChild(quote);

  const quoteText = document.createElement('div');
  quoteText.className = 'webclipper-inpage-comments-panel__quote-text';
  quoteText.textContent = '';
  quote.appendChild(quoteText);

  const composer = document.createElement('div');
  composer.className = 'webclipper-inpage-comments-panel__composer';
  body.appendChild(composer);

  const composerAvatar = document.createElement('div');
  composerAvatar.className = 'webclipper-inpage-comments-panel__avatar';
  composerAvatar.textContent = 'You';
  composer.appendChild(composerAvatar);

  const composerMain = document.createElement('div');
  composerMain.className = 'webclipper-inpage-comments-panel__composer-main';
  composer.appendChild(composerMain);

  const composerTextarea = document.createElement('textarea');
  composerTextarea.className = 'webclipper-inpage-comments-panel__composer-textarea';
  composerTextarea.placeholder = 'Write a comment…';
  composerTextarea.rows = 2;
  composerMain.appendChild(composerTextarea);

  const composerActions = document.createElement('div');
  composerActions.className = 'webclipper-inpage-comments-panel__composer-actions';
  composerMain.appendChild(composerActions);

  const composerSend = document.createElement('button');
  composerSend.className = 'webclipper-inpage-comments-panel__send is-primary';
  composerSend.type = 'button';
  composerSend.setAttribute('aria-label', 'Comment');
  composerSend.textContent = '↑';
  composerActions.appendChild(composerSend);

  const meta = document.createElement('div');
  meta.className = 'webclipper-inpage-comments-panel__meta';
  meta.textContent = 'Comments';
  body.appendChild(meta);

  const threads = document.createElement('div');
  threads.className = 'webclipper-inpage-comments-panel__threads';
  body.appendChild(threads);

  const empty = document.createElement('div');
  empty.className = 'webclipper-inpage-comments-panel__empty';
  empty.textContent = 'No comments yet';

  const state = {
    busy: false,
    handlers: { onSave: null as any, onReply: null as any, onDelete: null as any, onLocate: null as any },
  };

  function refreshButtons() {
    const text = String((composerTextarea as any).value || '').trim();
    composerSend.disabled = state.busy || !text;
    composerTextarea.disabled = state.busy;

    const replyInputs = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__reply-textarea'
    ) as NodeListOf<HTMLTextAreaElement> | null;
    replyInputs?.forEach?.((el) => {
      try {
        el.disabled = state.busy;
      } catch (_e) {
        // ignore
      }
    });

    const sendButtons = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__send'
    ) as NodeListOf<HTMLButtonElement> | null;
    sendButtons?.forEach?.((el) => {
      try {
        const isComposer = el === composerSend;
        if (isComposer) return;
        const threadText = String((el as any).__webclipperTextValue?.() || '').trim();
        el.disabled = state.busy || !threadText;
      } catch (_e) {
        // ignore
      }
    });
  }

  composerTextarea.addEventListener('input', () => refreshButtons());
  composerTextarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    composerSend.click();
  });

  composerSend.addEventListener('click', async () => {
    if (state.busy) return;
    const text = String((composerTextarea as any).value || '').trim();
    if (!text) return;
    const handler = state.handlers.onSave;
    if (typeof handler !== 'function') return;
    try {
      state.busy = true;
      refreshButtons();
      await handler(text);
      (composerTextarea as any).value = '';
    } finally {
      state.busy = false;
      refreshButtons();
    }
  });

  (el as any).__webclipperApi = {
    setBusy(busy: boolean) {
      state.busy = !!busy;
      refreshButtons();
    },
    setQuoteText(text: string) {
      const value = String(text || '');
      quoteText.textContent = value;
      quote.style.display = value ? 'block' : 'none';
    },
    setComments(items: InpageCommentItem[]) {
      threads.textContent = '';
      const normalized = (Array.isArray(items) ? items : []).filter((x) => x && Number.isFinite(Number((x as any)?.id)));
      meta.textContent = `Comments · ${normalized.length}`;
      if (!normalized.length) {
        threads.appendChild(empty);
        return;
      }

      const roots = normalized.filter((it) => !it.parentId);
      const repliesByRoot = new Map<number, InpageCommentItem[]>();
      for (const it of normalized) {
        if (!it.parentId) continue;
        const rootId = Number(it.parentId);
        const list = repliesByRoot.get(rootId) || [];
        list.push(it);
        repliesByRoot.set(rootId, list);
      }

      for (const root of roots) {
        const rootId = Number(root.id);
        const thread = document.createElement('div');
        thread.className = 'webclipper-inpage-comments-panel__thread';
        threads.appendChild(thread);

        thread.addEventListener('click', (e) => {
          const target = e?.target as HTMLElement | null;
          if (target?.closest?.('button,textarea')) return;
          const handler = state.handlers.onLocate;
          if (typeof handler !== 'function') return;
          void Promise.resolve(handler(root));
        });

        const quoteValue = String(root?.quoteText || '').trim();
        if (quoteValue) {
          const q = document.createElement('div');
          q.className = 'webclipper-inpage-comments-panel__thread-quote';
          thread.appendChild(q);

          const qText = document.createElement('div');
          qText.className = 'webclipper-inpage-comments-panel__thread-quote-text';
          qText.textContent = quoteValue;
          q.appendChild(qText);
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

        const author = document.createElement('div');
        author.className = 'webclipper-inpage-comments-panel__comment-author';
        author.textContent = String(root?.authorName || 'You');
        commentMeta.appendChild(author);

        const time = document.createElement('div');
        time.className = 'webclipper-inpage-comments-panel__comment-time';
        time.textContent = formatTime(root?.createdAt ?? null);
        commentMeta.appendChild(time);

        const commentActions = document.createElement('div');
        commentActions.className = 'webclipper-inpage-comments-panel__comment-actions';
        commentHeader.appendChild(commentActions);

        const del = document.createElement('button');
        del.className = 'webclipper-inpage-comments-panel__icon-btn is-danger';
        del.type = 'button';
        del.setAttribute('aria-label', 'Delete');
        del.textContent = '×';
        del.addEventListener('click', async () => {
          if (state.busy) return;
          const handler = state.handlers.onDelete;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(Number(root?.id));
          } finally {
            state.busy = false;
            refreshButtons();
          }
        });
        commentActions.appendChild(del);

        const commentBody = document.createElement('div');
        commentBody.className = 'webclipper-inpage-comments-panel__comment-body';
        commentBody.textContent = String(root?.commentText || '');
        comment.appendChild(commentBody);

        const replies = repliesByRoot.get(rootId) || [];
        if (replies.length) {
          const repliesWrap = document.createElement('div');
          repliesWrap.className = 'webclipper-inpage-comments-panel__replies';
          thread.appendChild(repliesWrap);

          for (const reply of replies) {
            const replyRow = document.createElement('div');
            replyRow.className = 'webclipper-inpage-comments-panel__reply';
            repliesWrap.appendChild(replyRow);

            replyRow.addEventListener('click', (e) => {
              const target = e?.target as HTMLElement | null;
              if (target?.closest?.('button')) return;
              const handler = state.handlers.onLocate;
              if (typeof handler !== 'function') return;
              void Promise.resolve(handler(root));
            });

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

            const replyDel = document.createElement('button');
            replyDel.className = 'webclipper-inpage-comments-panel__icon-btn is-danger';
            replyDel.type = 'button';
            replyDel.setAttribute('aria-label', 'Delete');
            replyDel.textContent = '×';
            replyDel.addEventListener('click', async () => {
              if (state.busy) return;
              const handler = state.handlers.onDelete;
              if (typeof handler !== 'function') return;
              try {
                state.busy = true;
                refreshButtons();
                await handler(Number(reply?.id));
              } finally {
                state.busy = false;
                refreshButtons();
              }
            });
            replyActions.appendChild(replyDel);

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

        const replySend = document.createElement('button');
        replySend.className = 'webclipper-inpage-comments-panel__send';
        replySend.type = 'button';
        replySend.setAttribute('aria-label', 'Reply');
        replySend.textContent = '↑';
        replyComposer.appendChild(replySend);

        (replySend as any).__webclipperTextValue = () => String((replyTextarea as any).value || '');

        replyTextarea.addEventListener('input', () => refreshButtons());
        replyTextarea.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          if (!(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          replySend.click();
        });

        replySend.addEventListener('click', async () => {
          if (state.busy) return;
          const text = String((replyTextarea as any).value || '').trim();
          if (!text) return;
          const handler = state.handlers.onReply;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(rootId, text);
            (replyTextarea as any).value = '';
          } finally {
            state.busy = false;
            refreshButtons();
          }
        });
      }

      refreshButtons();
    },
    setHandlers(handlers: any) {
      state.handlers = handlers || { onSave: null, onReply: null, onDelete: null, onLocate: null };
    },
    setTitle(text: string) {
      title.textContent = String(text || 'Comments');
    },
  };

  refreshButtons();
  (el as any).__webclipperCleanup = () => {};

  document.documentElement.appendChild(el);
  return el as any;
}

function applyPanelHostLayoutStyles(el: HTMLElement) {
  setImportantStyle(el, 'display', 'block');
  setImportantStyle(el, 'position', 'fixed');
  setImportantStyle(el, 'top', '0');
  setImportantStyle(el, 'right', '0');
  setImportantStyle(el, 'z-index', '2147483647');
  setImportantStyle(el, 'margin', '0');
  setImportantStyle(el, 'padding', '0');
  setImportantStyle(el, 'border', '0');
  setImportantStyle(el, 'background', 'transparent');
  setImportantStyle(el, 'pointer-events', 'auto');
  setImportantStyle(el, 'isolation', 'isolate');
}

const apiRef: InpageCommentsPanelApi = {
  open(input) {
    const el = ensurePanelElement();
    const shadow = (el as any).shadowRoot as ShadowRoot | null;
    const api = (el as any).__webclipperApi;
    const body = shadow?.querySelector?.('.webclipper-inpage-comments-panel__body') as HTMLElement | null;
    if (body) body.scrollTop = 0;
    setImportantStyle(el, 'display', 'block');
    if (input?.focusEditor) {
      const textarea = shadow?.querySelector?.('.webclipper-inpage-comments-panel__textarea') as HTMLTextAreaElement | null;
      textarea?.focus?.();
    }
    if (api?.setBusy) api.setBusy(false);
  },
  close() {
    const el = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (!el) return;
    setImportantStyle(el, 'display', 'none');
  },
  isOpen() {
    const el = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (!el) return false;
    return (getComputedStyle(el).display || '') !== 'none';
  },
  setBusy(busy) {
    const el = ensurePanelElement();
    (el as any).__webclipperApi?.setBusy?.(busy);
  },
  setQuoteText(text) {
    const el = ensurePanelElement();
    (el as any).__webclipperApi?.setQuoteText?.(text);
  },
  setComments(items) {
    const el = ensurePanelElement();
    (el as any).__webclipperApi?.setComments?.(items);
  },
  setHandlers(handlers) {
    const el = ensurePanelElement();
    (el as any).__webclipperApi?.setHandlers?.(handlers);
  },
  setTitle(title) {
    const el = ensurePanelElement();
    (el as any).__webclipperApi?.setTitle?.(title);
  },
};

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}

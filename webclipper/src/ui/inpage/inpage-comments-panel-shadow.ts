import inpageCommentsPanelCssRaw from '../styles/inpage-comments-panel.css?raw';

export type InpageCommentItem = {
  id: number;
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

  const editor = document.createElement('div');
  editor.className = 'webclipper-inpage-comments-panel__editor';
  body.appendChild(editor);

  const textarea = document.createElement('textarea');
  textarea.className = 'webclipper-inpage-comments-panel__textarea';
  textarea.placeholder = 'Write a comment…';
  editor.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'webclipper-inpage-comments-panel__actions';
  editor.appendChild(actions);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'webclipper-inpage-comments-panel__btn is-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  const meta = document.createElement('div');
  meta.className = 'webclipper-inpage-comments-panel__meta';
  meta.textContent = 'Comments';
  body.appendChild(meta);

  const list = document.createElement('div');
  list.className = 'webclipper-inpage-comments-panel__list';
  body.appendChild(list);

  const empty = document.createElement('div');
  empty.className = 'webclipper-inpage-comments-panel__empty';
  empty.textContent = 'No comments yet';

  const state = {
    busy: false,
    handlers: { onSave: null as any, onDelete: null as any, onLocate: null as any },
  };

  function refreshButtons() {
    const text = String((textarea as any).value || '').trim();
    saveBtn.disabled = state.busy || !text;
    textarea.disabled = state.busy;
    saveBtn.textContent = state.busy ? 'Saving…' : 'Save';
  }

  textarea.addEventListener('input', () => refreshButtons());

  saveBtn.addEventListener('click', async () => {
    if (state.busy) return;
    const text = String((textarea as any).value || '').trim();
    if (!text) return;
    const handler = state.handlers.onSave;
    if (typeof handler !== 'function') return;
    try {
      state.busy = true;
      refreshButtons();
      await handler(text);
      (textarea as any).value = '';
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
      list.textContent = '';
      const normalized = Array.isArray(items) ? items : [];
      meta.textContent = `Comments · ${normalized.length}`;
      if (!normalized.length) {
        list.appendChild(empty);
        return;
      }
      for (const item of normalized) {
        const card = document.createElement('div');
        card.className = 'webclipper-inpage-comments-panel__card';
        list.appendChild(card);
        card.addEventListener('click', (e) => {
          const target = e?.target as HTMLElement | null;
          if (target?.closest?.('button')) return;
          const handler = state.handlers.onLocate;
          if (typeof handler !== 'function') return;
          void Promise.resolve(handler(item));
        });

        const headerRow = document.createElement('div');
        headerRow.className = 'webclipper-inpage-comments-panel__card-header';
        card.appendChild(headerRow);

        const author = document.createElement('div');
        author.className = 'webclipper-inpage-comments-panel__card-author';
        author.textContent = String(item?.authorName || 'You');
        headerRow.appendChild(author);

        const right = document.createElement('div');
        right.style.display = 'inline-flex';
        right.style.alignItems = 'center';
        right.style.gap = '8px';
        headerRow.appendChild(right);

        const time = document.createElement('div');
        time.className = 'webclipper-inpage-comments-panel__card-time';
        time.textContent = formatTime(item?.createdAt ?? null);
        right.appendChild(time);

        const del = document.createElement('button');
        del.className = 'webclipper-inpage-comments-panel__btn is-danger';
        del.type = 'button';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          if (state.busy) return;
          const handler = state.handlers.onDelete;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(Number(item?.id));
          } finally {
            state.busy = false;
            refreshButtons();
          }
        });
        right.appendChild(del);

        const text = document.createElement('div');
        text.className = 'webclipper-inpage-comments-panel__card-text';
        text.textContent = String(item?.commentText || '');
        card.appendChild(text);
      }
    },
    setHandlers(handlers: any) {
      state.handlers = handlers || { onSave: null, onDelete: null };
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

import inpageItemMentionCssRaw from '@ui/styles/inpage-item-mention.css?raw';

const MENTION_ID = 'webclipper-inpage-item-mention';
const MENTION_SHADOW_CSS = String(inpageItemMentionCssRaw || '');

type MentionUiItem = {
  title: string;
  source: string;
  domain: string;
};

const state = {
  onPick: null as ((index: number) => void) | null,
};

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function applyHostLayoutStyles(el: HTMLElement) {
  setImportantStyle(el, 'display', 'none');
  setImportantStyle(el, 'position', 'fixed');
  setImportantStyle(el, 'z-index', '2147483647');
  setImportantStyle(el, 'margin', '0');
  setImportantStyle(el, 'padding', '0');
  setImportantStyle(el, 'border', '0');
  setImportantStyle(el, 'background', 'transparent');
  setImportantStyle(el, 'pointer-events', 'auto');
  setImportantStyle(el, 'box-shadow', 'none');
  setImportantStyle(el, 'isolation', 'isolate');
}

function ensureMentionEl(): HTMLElement | null {
  const doc = document;
  if (!doc || !doc.documentElement) return null;
  const existing = doc.getElementById(MENTION_ID) as HTMLElement | null;
  if (existing) return existing;

  const host = document.createElement('webclipper-inpage-item-mention');
  host.id = MENTION_ID;
  applyHostLayoutStyles(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = MENTION_SHADOW_CSS;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'webclipper-item-mention';
  shadow.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'webclipper-item-mention__header';
  header.textContent = '$ mention';
  panel.appendChild(header);

  const empty = document.createElement('div');
  empty.className = 'webclipper-item-mention__empty';
  empty.textContent = 'No matches';
  panel.appendChild(empty);

  const list = document.createElement('ul');
  list.className = 'webclipper-item-mention__list';
  list.setAttribute('role', 'listbox');
  panel.appendChild(list);

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as any;
    const li = target?.closest?.('li');
    if (!li) return;
    const index = Number(li.getAttribute('data-index'));
    if (!Number.isFinite(index) || index < 0) return;
    state.onPick?.(index);
  });

  doc.documentElement.appendChild(host);
  return host;
}

function setDisplay(el: HTMLElement, visible: boolean) {
  setImportantStyle(el, 'display', visible ? 'block' : 'none');
}

function setPosition(el: HTMLElement, left: number, top: number) {
  setImportantStyle(el, 'left', `${Math.max(6, Math.round(left))}px`);
  setImportantStyle(el, 'top', `${Math.max(6, Math.round(top))}px`);
}

function setList(el: HTMLElement, items: MentionUiItem[], highlightIndex: number) {
  const shadow = (el as any).shadowRoot as ShadowRoot | null;
  const list = shadow?.querySelector?.('.webclipper-item-mention__list') as HTMLElement | null;
  const empty = shadow?.querySelector?.('.webclipper-item-mention__empty') as HTMLElement | null;
  if (!list) return;

  while (list.firstChild) list.removeChild(list.firstChild);

  const safeItems = Array.isArray(items) ? items : [];
  const hasItems = safeItems.length > 0;
  if (empty) setImportantStyle(empty, 'display', hasItems ? 'none' : 'block');
  if (!hasItems) return;

  for (let i = 0; i < safeItems.length; i += 1) {
    const item = safeItems[i]!;
    const li = document.createElement('li');
    li.className = 'webclipper-item-mention__item';
    if (i === highlightIndex) li.classList.add('is-active');
    li.setAttribute('role', 'option');
    li.setAttribute('data-index', String(i));

    const title = document.createElement('div');
    title.className = 'webclipper-item-mention__title';
    title.textContent = String(item.title || '');
    li.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'webclipper-item-mention__meta';
    const source = document.createElement('span');
    source.textContent = String(item.source || '');
    const domain = document.createElement('span');
    domain.textContent = String(item.domain || '');
    meta.appendChild(source);
    meta.appendChild(domain);
    li.appendChild(meta);

    list.appendChild(li);
  }

  try {
    const active = list.querySelector('.webclipper-item-mention__item.is-active') as HTMLElement | null;
    active?.scrollIntoView?.({ block: 'nearest' } as any);
  } catch (_e) {
    // ignore
  }
}

function removeMentionEl() {
  const el = document.getElementById(MENTION_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

export const inpageItemMentionApi = {
  render(input: {
    open: boolean;
    items: MentionUiItem[];
    highlightIndex: number;
    position?: { left: number; top: number } | null;
    onPick?: ((index: number) => void) | null;
  }) {
    const el = ensureMentionEl();
    if (!el) return;
    state.onPick = typeof input.onPick === 'function' ? input.onPick : null;

    if (!input.open) {
      setDisplay(el, false);
      return;
    }

    const pos = input.position || { left: 12, top: 12 };
    setPosition(el, pos.left, pos.top);
    setList(el, input.items, Math.max(0, Number(input.highlightIndex || 0)));
    setDisplay(el, true);
  },
  cleanup() {
    state.onPick = null;
    removeMentionEl();
  },
} as const;

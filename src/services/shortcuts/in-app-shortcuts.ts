import { storageGet, storageRemove, storageSet } from '@services/shared/storage';

export const IN_APP_SHORTCUT_STORAGE_KEY = 'in_app_shortcuts_v1';

export const IN_APP_SHORTCUT_ACTIONS = [
  { id: 'toggle-sidebar', group: 'navigation', labelKey: 'keyboardShortcutsToggleSidebar', defaultKey: 'Alt+Shift+B' },
  { id: 'open-settings', group: 'navigation', labelKey: 'settingsLabel', defaultKey: 'Alt+Shift+P' },
  { id: 'open-insights', group: 'navigation', labelKey: 'section_aboutyou_label', defaultKey: '' },
  { id: 'back-to-list', group: 'navigation', labelKey: 'backButton', defaultKey: 'Alt+Shift+ArrowLeft' },
  { id: 'capture-page', group: 'navigation', labelKey: 'keyboardShortcutsCaptureCurrentPage', defaultKey: '' },
  { id: 'popup-comments', group: 'navigation', labelKey: 'openInpageCommentsSidebar', defaultKey: '' },
  { id: 'filter-source', group: 'library', labelKey: 'sourceFilterAria', defaultKey: 'Alt+Shift+F' },
  { id: 'filter-site', group: 'library', labelKey: 'insightArticleDomainsTitle', defaultKey: '' },
  { id: 'select-loaded', group: 'library', labelKey: 'selectAll', defaultKey: 'Alt+Shift+A' },
  {
    id: 'next-conversation',
    group: 'library',
    labelKey: 'keyboardShortcutsNextConversation',
    defaultKey: 'Alt+Shift+ArrowDown',
  },
  {
    id: 'previous-conversation',
    group: 'library',
    labelKey: 'keyboardShortcutsPreviousConversation',
    defaultKey: 'Alt+Shift+ArrowUp',
  },
  { id: 'copy-list-markdown', group: 'library', labelKey: 'copyFullMarkdown', defaultKey: '' },
  { id: 'copy-list-link', group: 'library', labelKey: 'detailHeaderCopyLinkMenuLabel', defaultKey: '' },
  { id: 'delete-selected', group: 'library', labelKey: 'deleteButton', defaultKey: '' },
  { id: 'export-menu', group: 'library', labelKey: 'exportButton', defaultKey: '' },
  { id: 'export-markdown', group: 'library', labelKey: 'markdownExport', defaultKey: '' },
  { id: 'export-json', group: 'library', labelKey: 'jsonExport', defaultKey: '' },
  { id: 'sync-menu', group: 'library', labelKey: 'syncTo', defaultKey: '' },
  { id: 'sync-notion', group: 'library', labelKey: 'notionSync', defaultKey: '' },
  { id: 'sync-obsidian', group: 'library', labelKey: 'obsidianSync', defaultKey: '' },
  { id: 'sync-feishu', group: 'library', labelKey: 'feishuSync', defaultKey: '' },
  { id: 'sync-github', group: 'library', labelKey: 'githubSync', defaultKey: '' },
  { id: 'detail-copy-link', group: 'detail', labelKey: 'detailHeaderCopyLinkMenuLabel', defaultKey: 'Alt+Shift+C' },
  { id: 'detail-copy-notion', group: 'detail', labelKey: 'detailHeaderCopyNotionLink', defaultKey: '' },
  { id: 'detail-copy-feishu', group: 'detail', labelKey: 'detailHeaderCopyFeishuLink', defaultKey: '' },
  { id: 'detail-copy-github', group: 'detail', labelKey: 'detailHeaderCopyGithubLink', defaultKey: '' },
  { id: 'detail-comments', group: 'detail', labelKey: 'openCommentsSidebar', defaultKey: 'Alt+Shift+J' },
  { id: 'detail-more', group: 'detail', labelKey: 'moreButton', defaultKey: 'Alt+Shift+M' },
  { id: 'detail-markdown', group: 'detail', labelKey: 'copyFullMarkdown', defaultKey: '' },
  { id: 'detail-original', group: 'detail', labelKey: 'openOriginalChat', defaultKey: 'Alt+Shift+O' },
  { id: 'detail-open-notion', group: 'detail', labelKey: 'detailHeaderOpenInNotion', defaultKey: '' },
  { id: 'detail-open-obsidian', group: 'detail', labelKey: 'detailHeaderOpenInObsidian', defaultKey: '' },
  { id: 'detail-open-feishu', group: 'detail', labelKey: 'detailHeaderOpenInFeishu', defaultKey: '' },
  { id: 'detail-open-github', group: 'detail', labelKey: 'detailHeaderOpenInGithub', defaultKey: '' },
  { id: 'reader-layout', group: 'reader', labelKey: 'readerTextLayoutButton', defaultKey: '' },
  { id: 'reader-theme', group: 'reader', labelKey: 'readerThemeButton', defaultKey: '' },
  { id: 'reader-narration', group: 'reader', labelKey: 'readerNarrationButton', defaultKey: '' },
  { id: 'reader-play-pause', group: 'reader', labelKey: 'keyboardShortcutsReaderPlayPause', defaultKey: '' },
  { id: 'reader-stop', group: 'reader', labelKey: 'readerNarrationStop', defaultKey: '' },
] as const satisfies ReadonlyArray<{
  id: string;
  group: 'navigation' | 'library' | 'detail' | 'reader';
  labelKey: string;
  defaultKey: string;
}>;

export type InAppShortcutAction = (typeof IN_APP_SHORTCUT_ACTIONS)[number]['id'];
export type InAppShortcutBindings = Record<InAppShortcutAction, string>;

const ACTION_IDS = new Set<string>(IN_APP_SHORTCUT_ACTIONS.map(({ id }) => id));
const RESERVED_SHORTCUTS = new Set([
  'Mod+A',
  'Mod+C',
  'Mod+V',
  'Mod+X',
  'Mod+Z',
  'Mod+F',
  'Mod+L',
  'Mod+R',
  'Mod+W',
  'Mod+T',
  'Mod+N',
  'Mod+Q',
  'Mod+P',
  'Mod+S',
  'Mod+Shift+Z',
  'Mod+Shift+W',
  'Mod+Shift+T',
  'Mod+Shift+R',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
]);
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

function normalizedKey(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return key;
  return null;
}

export function normalizeInAppShortcut(value: unknown): string | null {
  if (value === '') return '';
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((part) => part.trim());
  const key = normalizedKey(parts.pop() || '');
  if (!key || parts.length === 0) return null;
  if (new Set(parts).size !== parts.length || parts.some((part) => !MODIFIER_ORDER.includes(part as any))) {
    return null;
  }
  if (!parts.some((part) => part !== 'Shift')) return null;
  const shortcut = [...MODIFIER_ORDER.filter((modifier) => parts.includes(modifier)), key].join('+');
  return RESERVED_SHORTCUTS.has(shortcut) ? null : shortcut;
}

export function shortcutFromKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  isMac: boolean,
): string | null {
  if (['Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
  const modifiers = [
    ...(event.metaKey ? [isMac ? 'Mod' : 'Meta'] : []),
    ...(event.ctrlKey ? [isMac ? 'Ctrl' : 'Mod'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
  ];
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(-1)
      : event.key;
  return normalizeInAppShortcut([...modifiers, key].join('+'));
}

export function defaultInAppShortcutBindings(): InAppShortcutBindings {
  return Object.fromEntries(
    IN_APP_SHORTCUT_ACTIONS.map(({ id, defaultKey }) => [id, defaultKey]),
  ) as InAppShortcutBindings;
}

export function resolveInAppShortcutBindings(value: unknown): InAppShortcutBindings {
  const overrides =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const bindings = defaultInAppShortcutBindings();
  for (const action of IN_APP_SHORTCUT_ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, action.id)) continue;
    const parsed = normalizeInAppShortcut(overrides[action.id]);
    if (parsed != null) bindings[action.id] = parsed;
  }
  const used = new Set<string>();
  for (const action of IN_APP_SHORTCUT_ACTIONS) {
    const key = bindings[action.id];
    if (key && used.has(key)) bindings[action.id] = '';
    if (key) used.add(key);
  }
  return bindings;
}

export class InAppShortcutBindingError extends Error {
  constructor(
    public readonly code: 'invalid' | 'conflict',
    public readonly conflictingAction?: InAppShortcutAction,
  ) {
    super(code);
  }
}

export async function readInAppShortcutBindings(): Promise<InAppShortcutBindings> {
  const stored = await storageGet([IN_APP_SHORTCUT_STORAGE_KEY]);
  return resolveInAppShortcutBindings(stored[IN_APP_SHORTCUT_STORAGE_KEY]);
}

export async function updateInAppShortcutBinding(
  action: InAppShortcutAction,
  value: string,
): Promise<InAppShortcutBindings> {
  const parsed = normalizeInAppShortcut(value);
  if (!ACTION_IDS.has(action) || parsed === null) throw new InAppShortcutBindingError('invalid');

  const current = await storageGet([IN_APP_SHORTCUT_STORAGE_KEY]);
  const raw = current[IN_APP_SHORTCUT_STORAGE_KEY];
  const previous = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bindings = resolveInAppShortcutBindings(previous);
  const conflict = IN_APP_SHORTCUT_ACTIONS.find(({ id }) => id !== action && parsed && bindings[id] === parsed);
  if (conflict) throw new InAppShortcutBindingError('conflict', conflict.id);
  const next = { ...previous };
  const defaultKey = IN_APP_SHORTCUT_ACTIONS.find(({ id }) => id === action)!.defaultKey;
  if (parsed === defaultKey) delete next[action];
  else next[action] = parsed;
  await storageSet({ [IN_APP_SHORTCUT_STORAGE_KEY]: next });
  return resolveInAppShortcutBindings(next);
}

export async function resetInAppShortcutBindings(): Promise<InAppShortcutBindings> {
  await storageRemove([IN_APP_SHORTCUT_STORAGE_KEY]);
  return defaultInAppShortcutBindings();
}

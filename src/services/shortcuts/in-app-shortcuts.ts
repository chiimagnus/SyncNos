import { storageGet, storageRemove, storageSet } from '@services/shared/storage';
import { inAppShortcutsConflict, normalizeInAppShortcut } from './shortcut-keys';
export {
  normalizeInAppShortcut,
  shortcutFromKeyEvent,
  inAppShortcutMatches,
  inAppShortcutsConflict,
  isShortcutModifierKey,
  shortcutModifiersFromKeyEvent,
  shortcutPlatform,
  displayInAppShortcut,
  displayInAppShortcutParts,
} from './shortcut-keys';
export type { ShortcutPlatform, ShortcutKeyEvent } from './shortcut-keys';

export const IN_APP_SHORTCUT_STORAGE_KEY = 'in_app_shortcuts_v3';

export const IN_APP_SHORTCUT_ACTIONS = [
  { id: 'open-settings', group: 'navigation', labelKey: 'settingsLabel', defaultKey: 'Mod+Shift+Comma' },
  {
    id: 'toggle-sidebar',
    group: 'navigation',
    labelKey: 'keyboardShortcutsToggleSidebar',
    defaultKey: 'Mod+Backslash',
  },
  {
    id: 'previous-conversation',
    group: 'navigation',
    labelKey: 'keyboardShortcutsPreviousConversation',
    defaultKey: '',
  },
  { id: 'next-conversation', group: 'navigation', labelKey: 'keyboardShortcutsNextConversation', defaultKey: '' },
  { id: 'source-filter', group: 'filters', labelKey: 'sourceFilterAria', defaultKey: '' },
  { id: 'site-filter', group: 'filters', labelKey: 'insightArticleDomainsTitle', defaultKey: '' },
  { id: 'detail-copy-original', group: 'detail', labelKey: 'keyboardShortcutsCopyOriginalLink', defaultKey: '' },
  { id: 'detail-copy-notion', group: 'detail', labelKey: 'detailHeaderCopyNotionLink', defaultKey: '' },
  { id: 'detail-copy-feishu', group: 'detail', labelKey: 'detailHeaderCopyFeishuLink', defaultKey: '' },
  { id: 'detail-copy-github', group: 'detail', labelKey: 'detailHeaderCopyGithubLink', defaultKey: '' },
  { id: 'detail-open-original', group: 'detail', labelKey: 'openOriginalChat', defaultKey: '' },
  { id: 'detail-open-notion', group: 'detail', labelKey: 'detailHeaderOpenInNotion', defaultKey: '' },
  { id: 'detail-open-obsidian', group: 'detail', labelKey: 'detailHeaderOpenInObsidian', defaultKey: '' },
  { id: 'detail-open-feishu', group: 'detail', labelKey: 'detailHeaderOpenInFeishu', defaultKey: '' },
  { id: 'detail-open-github', group: 'detail', labelKey: 'detailHeaderOpenInGithub', defaultKey: '' },
  { id: 'detail-copy-markdown', group: 'detail', labelKey: 'copyFullMarkdown', defaultKey: '' },
  { id: 'detail-export-markdown', group: 'detail', labelKey: 'detailExportAsMarkdown', defaultKey: '' },
  { id: 'detail-export-json', group: 'detail', labelKey: 'detailExportAsJson', defaultKey: '' },
  { id: 'detail-comments', group: 'detail', labelKey: 'openCommentsSidebar', defaultKey: '' },
  { id: 'reader-play-pause', group: 'reader', labelKey: 'keyboardShortcutsReaderPlayPause', defaultKey: '' },
] as const satisfies ReadonlyArray<{
  id: string;
  group: 'navigation' | 'filters' | 'detail' | 'reader';
  labelKey: string;
  defaultKey: string;
}>;

export type InAppShortcutAction = (typeof IN_APP_SHORTCUT_ACTIONS)[number]['id'];

export const DETAIL_ACTION_SHORTCUTS = {
  'copy-original-link': 'detail-copy-original',
  'copy-full-markdown': 'detail-copy-markdown',
  'export-markdown': 'detail-export-markdown',
  'export-json': 'detail-export-json',
  'copy-notion-link': 'detail-copy-notion',
  'copy-feishu-link': 'detail-copy-feishu',
  'copy-github-link': 'detail-copy-github',
  'open-original': 'detail-open-original',
  'open-in-notion': 'detail-open-notion',
  'open-in-obsidian': 'detail-open-obsidian',
  'open-in-feishu': 'detail-open-feishu',
  'open-in-github': 'detail-open-github',
} as const satisfies Record<string, InAppShortcutAction>;
export type InAppShortcutBindings = Record<InAppShortcutAction, string>;

const ACTION_IDS = new Set<string>(IN_APP_SHORTCUT_ACTIONS.map(({ id }) => id));
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
  const used: string[] = [];
  for (const action of IN_APP_SHORTCUT_ACTIONS) {
    const key = bindings[action.id];
    if (key && used.some((previous) => inAppShortcutsConflict(previous, key))) bindings[action.id] = '';
    else if (key) used.push(key);
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
  const conflict = IN_APP_SHORTCUT_ACTIONS.find(
    ({ id }) => id !== action && parsed && inAppShortcutsConflict(bindings[id], parsed),
  );
  if (conflict) throw new InAppShortcutBindingError('conflict', conflict.id);
  const next: Record<string, string> = {};
  for (const item of IN_APP_SHORTCUT_ACTIONS) {
    if (bindings[item.id] !== item.defaultKey) next[item.id] = bindings[item.id];
  }
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

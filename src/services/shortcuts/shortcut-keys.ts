/** Logical shortcuts shared by the recorder and the event dispatcher. */
export type ShortcutPlatform = 'mac' | 'windows' | 'linux' | 'chromeos' | 'other';

type ModifierFamily = 'Ctrl' | 'Meta' | 'Alt' | 'Shift';
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;
const KEY_CODES = [
  'Space',
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'IntlBackslash',
  'IntlHash',
  'IntlRo',
  'IntlYen',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'PrintScreen',
  'Pause',
  'ContextMenu',
  'Help',
  'Again',
  'Copy',
  'Cut',
  'Paste',
  'Undo',
  'Find',
  'Open',
  'Props',
  'Select',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  'NumpadBackspace',
  'NumpadClear',
  'NumpadClearEntry',
  'NumpadHash',
  'NumpadStar',
  'NumpadMemoryAdd',
  'NumpadMemoryClear',
  'NumpadMemoryRecall',
  'NumpadMemoryStore',
  'NumpadMemorySubtract',
  'NumpadEqual',
  'NumpadComma',
  'NumpadParenLeft',
  'NumpadParenRight',
  'Convert',
  'NonConvert',
  'KanaMode',
  'Lang1',
  'Lang2',
  'Lang3',
  'Lang4',
  'Lang5',
  'AudioVolumeMute',
  'AudioVolumeDown',
  'AudioVolumeUp',
  'MediaPlayPause',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'MediaSelect',
  'BrowserBack',
  'BrowserForward',
  'BrowserRefresh',
  'BrowserStop',
  'BrowserSearch',
  'BrowserFavorites',
  'BrowserHome',
  'LaunchMail',
  'LaunchApp1',
  'LaunchApp2',
  'BrightnessDown',
  'BrightnessUp',
  'Eject',
  'Sleep',
  'WakeUp',
] as const;
const KEY_NAMES = new Map(KEY_CODES.map((code) => [code.toLowerCase(), code]));
const MODIFIER_NAMES = new Map<string, string>(MODIFIER_ORDER.map((key) => [key.toLowerCase(), key]));
const FALLBACK_KEYS: Record<string, string> = {
  ' ': 'Space',
  '+': 'Equal',
  '=': 'Equal',
  '-': 'Minus',
  _: 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  ';': 'Semicolon',
  ':': 'Semicolon',
  "'": 'Quote',
  '"': 'Quote',
  ',': 'Comma',
  '<': 'Comma',
  '.': 'Period',
  '>': 'Period',
  '/': 'Slash',
  '?': 'Slash',
  '\\': 'Backslash',
  '|': 'Backslash',
  '`': 'Backquote',
  '~': 'Backquote',
};
const SHORTCUT_LABELS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: 'Backspace',
  Delete: 'Delete',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  NumpadEqual: 'Num =',
  NumpadComma: 'Num ,',
};
const PROTECTED_SHORTCUTS = [
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
  'Mod+Tab',
  'Mod+Shift+Tab',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Alt+Tab',
  'Alt+Shift+Tab',
];

export function shortcutPlatform(
  navigatorValue: Pick<Navigator, 'platform' | 'userAgent'> = navigator,
): ShortcutPlatform {
  const hint = String(
    (navigatorValue as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigatorValue.platform ||
      navigatorValue.userAgent ||
      '',
  );
  if (/Mac|iPhone|iPad/i.test(hint)) return 'mac';
  if (/Win/i.test(hint)) return 'windows';
  if (/CrOS|Chrome OS/i.test(hint)) return 'chromeos';
  if (/Linux|X11|BSD|Unix/i.test(hint)) return 'linux';
  return 'other';
}

function normalizeKey(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (/^Numpad[0-9]$/i.test(key)) return `Numpad${key.at(-1)}`;
  return KEY_NAMES.get(key.toLowerCase()) || null;
}

function requirements(shortcut: string, platform: ShortcutPlatform): { key: string; mods: Set<ModifierFamily> } | null {
  const parts = shortcut.split('+');
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set<ModifierFamily>();
  for (const modifier of parts) {
    const family = modifier === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Ctrl') : modifier;
    if (!['Ctrl', 'Meta', 'Alt', 'Shift'].includes(family) || mods.has(family as ModifierFamily)) return null;
    mods.add(family as ModifierFamily);
  }
  return { key, mods };
}

function sameModifiers(a: Set<ModifierFamily>, b: Set<ModifierFamily>): boolean {
  return a.size === b.size && [...a].every((modifier) => b.has(modifier));
}

function shortcutOverlap(a: string, b: string): boolean {
  for (const platform of ['mac', 'windows', 'linux'] as const) {
    const left = requirements(a, platform);
    const right = requirements(b, platform);
    if (left && right && left.key === right.key && sameModifiers(left.mods, right.mods)) return true;
  }
  return false;
}

export function inAppShortcutsConflict(a: string, b: string): boolean {
  const first = normalizeInAppShortcut(a);
  const second = normalizeInAppShortcut(b);
  return !!first && !!second && shortcutOverlap(first, second);
}

export function normalizeInAppShortcut(value: unknown): string | null {
  if (value === '') return '';
  if (typeof value !== 'string') return null;
  const pieces = value.split('+').map((piece) => piece.trim());
  const key = normalizeKey(pieces.pop() || '');
  if (!key || new Set(pieces).size !== pieces.length) return null;
  const modifiers = pieces.map((piece) => MODIFIER_NAMES.get(piece.toLowerCase()));
  if (modifiers.some((modifier) => !modifier) || new Set(modifiers).size !== modifiers.length) return null;
  const sorted = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  const shortcut = [...sorted, key].join('+');
  if (shortcut === 'Tab' || shortcut === 'Escape') return null; // Keyboard accessibility.
  if (PROTECTED_SHORTCUTS.some((reserved) => shortcutOverlap(shortcut, reserved))) return null;
  return shortcut;
}

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export function isShortcutModifierKey(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
  return (
    /^(?:Control|Meta|Alt|Shift)(?:Left|Right)$|^OS(?:Left|Right)$/.test(event.code) ||
    ['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS', 'Super'].includes(event.key)
  );
}

export function shortcutModifiersFromKeyEvent(event: ShortcutKeyEvent, platform: ShortcutPlatform): string {
  const modifiers: string[] = [];
  if (platform === 'mac' ? event.metaKey : event.ctrlKey) modifiers.push('Mod');
  if (platform === 'mac' ? event.ctrlKey : event.metaKey) modifiers.push(platform === 'mac' ? 'Ctrl' : 'Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return modifiers.join('+');
}

function eventMainKey(event: ShortcutKeyEvent): string | null {
  if (isShortcutModifierKey(event) || ['Fn', 'FnLock'].includes(event.key)) return null;
  if (['Process', 'Unidentified'].includes(event.key)) return null;
  if (event.key === 'Dead' && !/^Key[A-Z]$|^Digit[0-9]$/.test(event.code) && !normalizeKey(event.code)) return null;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  return normalizeKey(event.code) || normalizeKey(event.key) || FALLBACK_KEYS[event.key] || null;
}

export function shortcutFromKeyEvent(event: ShortcutKeyEvent, platform: ShortcutPlatform): string | null {
  const key = eventMainKey(event);
  if (!key) return null;
  return normalizeInAppShortcut([shortcutModifiersFromKeyEvent(event, platform), key].filter(Boolean).join('+'));
}

export function inAppShortcutMatches(binding: string, pressed: string, platform: ShortcutPlatform): boolean {
  if (!binding || !pressed) return false;
  const expected = requirements(binding, platform);
  const received = requirements(pressed, platform);
  return !!expected && !!received && expected.key === received.key && sameModifiers(expected.mods, received.mods);
}

function displayModifier(modifier: string, platform: ShortcutPlatform): string {
  const mac = platform === 'mac';
  const meta = mac ? '⌘' : platform === 'windows' ? 'Win' : platform === 'chromeos' ? 'Search' : 'Super';
  const part = modifier;
  const glyph =
    part === 'Mod'
      ? mac
        ? '⌘'
        : 'Ctrl'
      : part === 'Ctrl' || part === 'Control'
        ? mac
          ? '⌃'
          : 'Ctrl'
        : part === 'Meta'
          ? meta
          : part === 'Alt'
            ? mac
              ? '⌥'
              : 'Alt'
            : part === 'Shift'
              ? mac
                ? '⇧'
                : 'Shift'
              : part;
  return glyph;
}

export function displayInAppShortcutParts(value: string, platform: ShortcutPlatform): string[] {
  if (!value) return [];
  const pieces = value.split('+');
  return pieces.map((piece) => {
    if (MODIFIER_NAMES.has(piece.toLowerCase())) return displayModifier(piece, platform);
    if (/^Numpad[0-9]$/.test(piece)) return `Num ${piece.at(-1)}`;
    if (platform === 'mac' && piece === 'Backspace') return '⌫';
    if (platform === 'mac' && piece === 'Delete') return '⌦';
    if (platform === 'mac' && piece === 'Enter') return '↩';
    if (platform === 'mac' && piece === 'Tab') return '⇥';
    return SHORTCUT_LABELS[piece] || piece;
  });
}

export function displayInAppShortcut(value: string, platform: ShortcutPlatform): string {
  return displayInAppShortcutParts(value, platform).join(' + ');
}

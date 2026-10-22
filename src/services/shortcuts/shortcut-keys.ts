/** Physical keyboard shortcuts shared by the recorder and the event dispatcher. */
export type ShortcutPlatform = 'mac' | 'windows' | 'linux' | 'chromeos' | 'other';

type PhysicalFamily = 'Control' | 'Meta' | 'Alt' | 'Shift';
type ModifierRequirement = { any: boolean; sides: Set<'Left' | 'Right'> };
type Requirements = Map<PhysicalFamily, ModifierRequirement>;

const MODIFIER_ORDER = [
  'Mod',
  'Ctrl',
  'Meta',
  'Alt',
  'Shift',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
] as const;
const MODIFIER_CODES = new Set<string>([
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
]);
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
const MODIFIER_FAMILIES = ['Control', 'Meta', 'Alt', 'Shift'] as const;
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

function physicalFamily(
  modifier: string,
  platform: ShortcutPlatform,
): { family: PhysicalFamily; side: 'Left' | 'Right' | null } | null {
  if (modifier === 'Mod') return { family: platform === 'mac' ? 'Meta' : 'Control', side: null };
  if (modifier === 'Ctrl') return { family: 'Control', side: null };
  if (modifier === 'Meta') return { family: 'Meta', side: null };
  if (modifier === 'Alt' || modifier === 'Shift') return { family: modifier, side: null };
  const match = /^(Control|Meta|Alt|Shift)(Left|Right)$/.exec(modifier);
  return match ? { family: match[1] as PhysicalFamily, side: match[2] as 'Left' | 'Right' } : null;
}

function requirements(shortcut: string, platform: ShortcutPlatform): { key: string; mods: Requirements } | null {
  const pieces = shortcut.split('+');
  const key = pieces.pop();
  if (!key) return null;
  const mods: Requirements = new Map();
  for (const modifier of pieces) {
    const physical = physicalFamily(modifier, platform);
    if (!physical) return null;
    const { family, side } = physical;
    let requirement = mods.get(family);
    if (!requirement) {
      requirement = { any: false, sides: new Set() };
      mods.set(family, requirement);
    }
    if (side) {
      if (requirement.any) return null;
      requirement.sides.add(side);
    } else {
      if (requirement.any || requirement.sides.size) return null;
      requirement.any = true;
    }
  }
  return { key, mods };
}

function modifiersIntersect(a: Requirements, b: Requirements): boolean {
  for (const family of MODIFIER_FAMILIES) {
    const left = a.get(family);
    const right = b.get(family);
    if ((left == null) !== (right == null)) return false;
    if (!left || !right || left.any || right.any) continue;
    if (left.sides.size !== right.sides.size) return false;
    for (const side of left.sides) if (!right.sides.has(side)) return false;
  }
  return true;
}

function shortcutOverlap(a: string, b: string): boolean {
  for (const platform of ['mac', 'windows', 'linux'] as const) {
    const left = requirements(a, platform);
    const right = requirements(b, platform);
    if (left && right && left.key === right.key && modifiersIntersect(left.mods, right.mods)) return true;
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

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
  location?: number;
};

export function physicalModifierKey(event: Pick<KeyboardEvent, 'key' | 'code'> & { location?: number }): string | null {
  if (MODIFIER_CODES.has(event.code)) return event.code;
  if (event.code === 'OSLeft') return 'MetaLeft';
  if (event.code === 'OSRight') return 'MetaRight';
  const family =
    event.key === 'Control'
      ? 'Control'
      : event.key === 'OS' || event.key === 'Meta' || event.key === 'Super'
        ? 'Meta'
        : event.key === 'Alt' || event.key === 'AltGraph'
          ? 'Alt'
          : event.key === 'Shift'
            ? 'Shift'
            : null;
  if (!family) return null;
  if (event.location !== 1 && event.location !== 2) return family === 'Control' ? 'Ctrl' : family;
  return `${family}${event.location === 1 ? 'Left' : 'Right'}`;
}

export function setHeldShortcutModifier(
  held: Set<string>,
  event: Pick<KeyboardEvent, 'key' | 'code'> & { location?: number },
  down: boolean,
) {
  const modifier = physicalModifierKey(event);
  if (!modifier) return false;
  if (down) held.add(modifier);
  else held.delete(modifier);
  return true;
}

export function heldShortcutModifiers(held: ReadonlySet<string>): string {
  return MODIFIER_ORDER.filter((code) => held.has(code)).join('+');
}

function eventMainKey(event: ShortcutKeyEvent): string | null {
  if (
    physicalModifierKey(event) ||
    ['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS', 'Super', 'Fn', 'FnLock'].includes(event.key)
  )
    return null;
  if (['Process', 'Unidentified'].includes(event.key)) return null;
  if (event.key === 'Dead' && !/^Key[A-Z]$|^Digit[0-9]$/.test(event.code) && !normalizeKey(event.code)) return null;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  return normalizeKey(event.code) || normalizeKey(event.key) || FALLBACK_KEYS[event.key] || null;
}

export function shortcutFromKeyEvent(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform | boolean,
  held: ReadonlySet<string> = new Set(),
): string | null {
  const key = eventMainKey(event);
  if (!key) return null;
  const resolvedPlatform = typeof platform === 'boolean' ? (platform ? 'mac' : 'windows') : platform;
  const modifiers: string[] = [];
  for (const family of MODIFIER_FAMILIES) {
    const active =
      family === 'Control'
        ? event.ctrlKey
        : family === 'Meta'
          ? event.metaKey
          : family === 'Alt'
            ? event.altKey
            : event.shiftKey;
    if (!active) continue;
    const left = `${family}Left`;
    const right = `${family}Right`;
    if (held.has(left)) modifiers.push(left);
    if (held.has(right)) modifiers.push(right);
    if (!held.has(left) && !held.has(right)) {
      modifiers.push(
        family === 'Control' && resolvedPlatform !== 'mac'
          ? 'Mod'
          : family === 'Meta' && resolvedPlatform === 'mac'
            ? 'Mod'
            : family === 'Control'
              ? 'Ctrl'
              : family,
      );
    }
  }
  return normalizeInAppShortcut([...modifiers, key].join('+'));
}

function modifiersMatchExactly(configured: Requirements, actual: Requirements): boolean {
  for (const family of MODIFIER_FAMILIES) {
    const expected = configured.get(family);
    const received = actual.get(family);
    if (!expected !== !received) return false;
    if (!expected || !received || expected.any) continue;
    if (received.any || expected.sides.size !== received.sides.size) return false;
    for (const side of expected.sides) if (!received.sides.has(side)) return false;
  }
  return true;
}

export function inAppShortcutMatches(binding: string, pressed: string, platform: ShortcutPlatform): boolean {
  if (!binding || !pressed) return false;
  // Both strings are normalized when saved / captured; avoid re-validating the entire shortcut registry on each keydown.
  const expected = requirements(binding, platform);
  const received = requirements(pressed, platform);
  if (!expected || !received || expected.key !== received.key) return false;
  return modifiersMatchExactly(expected.mods, received.mods);
}

function displayModifier(modifier: string, platform: ShortcutPlatform): string {
  const mac = platform === 'mac';
  const meta = mac ? '⌘' : platform === 'windows' ? 'Win' : platform === 'chromeos' ? 'Search' : 'Super';
  const physical = /^((?:Control|Meta|Alt|Shift))(Left|Right)$/.exec(modifier);
  const part = physical?.[1] || modifier;
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
  return physical ? `${physical[2] === 'Left' ? 'L' : 'R'} ${glyph}` : glyph;
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

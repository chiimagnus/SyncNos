import {
  commandsGetAll,
  getShortcutSettingsAccess,
  openShortcutSettings,
  type ShortcutSettingsAccess,
} from '@platform/webext/commands';
import {
  KEYBOARD_SHORTCUT_COMMAND_IDS,
  KEYBOARD_SHORTCUT_COMMAND_ORDER,
  type KeyboardShortcutCommandId,
} from '@services/shortcuts/keyboard-shortcut-contract';

export type KeyboardShortcutAction = 'open-popup' | 'capture-current-page' | 'open-app';
export type KeyboardShortcutManagerAccess = 'openable' | 'manual' | 'unsupported';
export type KeyboardShortcutOpenResult = 'opened' | 'manual' | 'unsupported';

export type KeyboardShortcutItem = {
  action: KeyboardShortcutAction;
  shortcut: string;
};

export type KeyboardShortcutSnapshot = {
  supported: boolean;
  items: KeyboardShortcutItem[];
  managerAccess: KeyboardShortcutManagerAccess;
};

const ACTION_BY_COMMAND: Record<KeyboardShortcutCommandId, KeyboardShortcutAction> = {
  [KEYBOARD_SHORTCUT_COMMAND_IDS.openPopup]: 'open-popup',
  [KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage]: 'capture-current-page',
  [KEYBOARD_SHORTCUT_COMMAND_IDS.openApp]: 'open-app',
};

const SHORTCUT_ACTIONS = KEYBOARD_SHORTCUT_COMMAND_ORDER.map((command) => ({
  action: ACTION_BY_COMMAND[command],
  command,
}));

function mapManagerAccess(access: ShortcutSettingsAccess): KeyboardShortcutManagerAccess {
  if (access === 'api' || access === 'chromium-url') return 'openable';
  return access;
}

function emptyItems(): KeyboardShortcutItem[] {
  return SHORTCUT_ACTIONS.map(({ action }) => ({ action, shortcut: '' }));
}

export async function readKeyboardShortcutSnapshot(): Promise<KeyboardShortcutSnapshot> {
  const managerAccess = mapManagerAccess(getShortcutSettingsAccess());
  try {
    const commands = await commandsGetAll();
    const shortcutByCommand = new Map(commands.map((command) => [command.name, command.shortcut]));
    return {
      supported: true,
      items: SHORTCUT_ACTIONS.map(({ action, command }) => ({
        action,
        shortcut: shortcutByCommand.get(command) ?? '',
      })),
      managerAccess,
    };
  } catch (_error) {
    return {
      supported: false,
      items: emptyItems(),
      managerAccess,
    };
  }
}

export async function openKeyboardShortcutSettings(): Promise<KeyboardShortcutOpenResult> {
  const result = await openShortcutSettings();
  if (result.opened) return 'opened';
  return result.access === 'unsupported' ? 'unsupported' : 'manual';
}

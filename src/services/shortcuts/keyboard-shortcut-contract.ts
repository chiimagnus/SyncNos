export const KEYBOARD_SHORTCUT_COMMAND_IDS = {
  openPopup: '_execute_action',
  captureCurrentPage: 'capture-current-page',
  openTab: 'open-syncnos-app',
} as const;

export const KEYBOARD_SHORTCUT_COMMAND_ORDER = [
  KEYBOARD_SHORTCUT_COMMAND_IDS.openPopup,
  KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage,
  KEYBOARD_SHORTCUT_COMMAND_IDS.openTab,
] as const;

export type KeyboardShortcutCommandId = (typeof KEYBOARD_SHORTCUT_COMMAND_ORDER)[number];

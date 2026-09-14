import { UI_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { commandsOnCommand } from '@platform/webext/commands';
import { KEYBOARD_SHORTCUT_COMMAND_IDS } from '@services/shortcuts/keyboard-shortcut-contract';

type ShortcutCaptureMessage = {
  type: typeof UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE;
  source: 'shortcut';
};

type BackgroundKeyboardShortcutDeps = {
  dispatchMessage: (message: ShortcutCaptureMessage) => unknown | Promise<unknown>;
  openApp: () => unknown | Promise<unknown>;
};

function runShortcutAction(action: () => unknown | Promise<unknown>): void {
  try {
    void Promise.resolve(action()).catch((error) => {
      console.error('[SyncNos] Keyboard shortcut action failed', error);
    });
  } catch (error) {
    console.error('[SyncNos] Keyboard shortcut action failed', error);
  }
}

export function registerBackgroundKeyboardShortcuts({ dispatchMessage, openApp }: BackgroundKeyboardShortcutDeps): boolean {
  return commandsOnCommand((command) => {
    if (command === KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage) {
      runShortcutAction(() =>
        dispatchMessage({
          type: UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE,
          source: 'shortcut',
        }),
      );
      return;
    }

    if (command === KEYBOARD_SHORTCUT_COMMAND_IDS.openApp) {
      runShortcutAction(openApp);
    }
  });
}

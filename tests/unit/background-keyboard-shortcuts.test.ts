import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandsOnCommand = vi.fn();

vi.mock('@platform/webext/commands', () => ({
  commandsOnCommand: (...args: any[]) => commandsOnCommand(...args),
}));

import { UI_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { registerBackgroundKeyboardShortcuts } from '@services/bootstrap/background-keyboard-shortcuts';
import { KEYBOARD_SHORTCUT_COMMAND_IDS } from '@services/shortcuts/keyboard-shortcut-contract';

describe('background keyboard shortcuts', () => {
  let listener: ((command: string) => void) | null;
  const dispatchMessage = vi.fn();
  const openApp = vi.fn();

  beforeEach(() => {
    listener = null;
    commandsOnCommand.mockReset();
    dispatchMessage.mockReset();
    openApp.mockReset();
    commandsOnCommand.mockImplementation((nextListener: (command: string) => void) => {
      listener = nextListener;
      return true;
    });
  });

  function register() {
    expect(registerBackgroundKeyboardShortcuts({ dispatchMessage, openApp })).toBe(true);
    if (!listener) throw new Error('keyboard command listener was not registered');
    return listener;
  }

  it('routes capture through the canonical active-tab UI message', () => {
    const onCommand = register();

    onCommand(KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage);

    expect(dispatchMessage).toHaveBeenCalledTimes(1);
    expect(dispatchMessage).toHaveBeenCalledWith({
      type: UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE,
      source: 'shortcut',
    });
    expect(openApp).not.toHaveBeenCalled();
  });

  it('opens the app without dispatching a capture message', () => {
    const onCommand = register();

    onCommand(KEYBOARD_SHORTCUT_COMMAND_IDS.openApp);

    expect(openApp).toHaveBeenCalledTimes(1);
    expect(dispatchMessage).not.toHaveBeenCalled();
  });

  it('ignores the reserved popup command and unknown commands', () => {
    const onCommand = register();

    onCommand(KEYBOARD_SHORTCUT_COMMAND_IDS.openPopup);
    onCommand('unknown-command');

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(openApp).not.toHaveBeenCalled();
  });

  it('contains rejected and synchronous shortcut failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispatchMessage.mockRejectedValueOnce(new Error('dispatch failed'));
    openApp.mockImplementationOnce(() => {
      throw new Error('open failed');
    });
    const onCommand = register();

    expect(() => onCommand(KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage)).not.toThrow();
    expect(() => onCommand(KEYBOARD_SHORTCUT_COMMAND_IDS.openApp)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});

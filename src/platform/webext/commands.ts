import { getURL } from '@platform/runtime/runtime';
import { webextApis, webextError, webextLastErrorMessage } from '@platform/webext/base';
import { tabsCreate } from '@platform/webext/tabs';

export type WebExtensionCommand = {
  name: string;
  description: string;
  shortcut: string;
};

export type ShortcutSettingsAccess = 'api' | 'chromium-url' | 'manual' | 'unsupported';

export type OpenShortcutSettingsResult = {
  opened: boolean;
  access: ShortcutSettingsAccess;
};

function normalizeCommands(value: unknown): WebExtensionCommand[] {
  if (!Array.isArray(value)) return [];
  return value.map((command: any) => ({
    name: String(command?.name || ''),
    description: String(command?.description || ''),
    shortcut: String(command?.shortcut || ''),
  }));
}

export function commandsOnCommand(listener: (command: string) => void): boolean {
  const { browser, chrome } = webextApis();
  const onCommand = browser?.commands?.onCommand ?? chrome?.commands?.onCommand;
  if (!onCommand?.addListener) return false;

  try {
    onCommand.addListener(listener);
    return true;
  } catch (_error) {
    // Commands support is optional; listener failure must not block background startup.
    return false;
  }
}

export async function commandsGetAll(): Promise<WebExtensionCommand[]> {
  const { browser, chrome } = webextApis();
  if (browser?.commands?.getAll) {
    return normalizeCommands(await Promise.resolve(browser.commands.getAll()));
  }

  if (chrome?.commands?.getAll) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.commands.getAll((commands: unknown) => {
          if (chrome?.runtime?.lastError) {
            reject(webextError(webextLastErrorMessage('commands.getAll failed')));
            return;
          }
          resolve(normalizeCommands(commands));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  throw webextError('commands.getAll unavailable');
}

function hasOpenShortcutSettingsApi(): boolean {
  const { browser, chrome } = webextApis();
  return Boolean(browser?.commands?.openShortcutSettings || chrome?.commands?.openShortcutSettings);
}

function runtimeScheme(): string {
  try {
    return (
      String(getURL('') || '')
        .split(':', 1)[0]
        ?.toLowerCase() || ''
    );
  } catch (_error) {
    return '';
  }
}

export function getShortcutSettingsAccess(): ShortcutSettingsAccess {
  if (hasOpenShortcutSettingsApi()) return 'api';
  const scheme = runtimeScheme();
  if (scheme === 'chrome-extension') return 'chromium-url';
  if (scheme) return 'manual';
  return 'unsupported';
}

function chromiumShortcutSettingsUrl(): string {
  const userAgent = String(globalThis.navigator?.userAgent || '');
  return /\bEdg\//.test(userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
}

export async function openShortcutSettings(): Promise<OpenShortcutSettingsResult> {
  const { browser, chrome } = webextApis();
  const access = getShortcutSettingsAccess();

  if (access === 'api') {
    const open = browser?.commands?.openShortcutSettings || chrome?.commands?.openShortcutSettings;
    try {
      await Promise.resolve(open.call(browser?.commands?.openShortcutSettings ? browser.commands : chrome.commands));
      return { opened: true, access: 'api' };
    } catch (_error) {
      return { opened: false, access: 'manual' };
    }
  }

  if (access === 'chromium-url') {
    try {
      await tabsCreate({ url: chromiumShortcutSettingsUrl(), active: true });
      return { opened: true, access: 'chromium-url' };
    } catch (_error) {
      return { opened: false, access: 'manual' };
    }
  }

  return { opened: false, access };
}

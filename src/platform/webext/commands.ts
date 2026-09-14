import { webextApis } from '@platform/webext/base';

export function commandsOnCommand(listener: (command: string) => void): boolean {
  const { browser, chrome } = webextApis();
  try {
    if (browser?.commands?.onCommand?.addListener) {
      browser.commands.onCommand.addListener(listener);
      return true;
    }
    if (chrome?.commands?.onCommand?.addListener) {
      chrome.commands.onCommand.addListener(listener);
      return true;
    }
  } catch (_error) {
    // Missing or partially implemented Commands APIs must not block extension startup.
  }
  return false;
}

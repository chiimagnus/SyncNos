import { scriptingExecuteScript } from '@platform/webext/scripting';
import { tabsQuery, tabsSendMessage } from '@platform/webext/tabs';

const contentScriptRecoveryByTab = new Map<number, Promise<void>>();

function isMissingContentScriptReceiver(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '');
  return /receiving end does not exist|no matching message handler/i.test(message);
}

function ensureContentScript(tabId: number): Promise<void> {
  const current = contentScriptRecoveryByTab.get(tabId);
  if (current) return current;

  const recovery = scriptingExecuteScript({
    target: { tabId },
    files: ['content-scripts/content.js'],
  })
    .then(() => undefined)
    .finally(() => contentScriptRecoveryByTab.delete(tabId));
  contentScriptRecoveryByTab.set(tabId, recovery);
  return recovery;
}

export async function sendToContentScript(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  try {
    return await tabsSendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentScriptReceiver(error)) throw error;
    await ensureContentScript(tabId);
    return await tabsSendMessage(tabId, message);
  }
}

export async function refreshContentScriptsAfterExtensionUpdate(): Promise<void> {
  const tabs = await tabsQuery({ url: ['http://*/*', 'https://*/*'] });
  const tabIds = tabs.map((tab) => tab.id).filter((tabId): tabId is number => typeof tabId === 'number' && tabId > 0);

  await Promise.allSettled(tabIds.map((tabId) => ensureContentScript(tabId)));
}

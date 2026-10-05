import { scriptingExecuteScript } from '@platform/webext/scripting';
import { tabsQuery, tabsSendMessage } from '@platform/webext/tabs';

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';
const contentScriptRecoveryByTab = new Map<number, Promise<void>>();

function isMissingContentScriptReceiver(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '');
  return /receiving end does not exist|no matching message handler/i.test(message);
}

async function ensureContentScript(tabId: number): Promise<void> {
  let recovery = contentScriptRecoveryByTab.get(tabId);
  if (!recovery) {
    recovery = scriptingExecuteScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    })
      .then(() => undefined)
      .finally(() => contentScriptRecoveryByTab.delete(tabId));
    contentScriptRecoveryByTab.set(tabId, recovery);
  }
  await recovery;
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
  const tabIds = Array.from(
    new Set(tabs.map((tab) => Number(tab?.id)).filter((tabId) => Number.isFinite(tabId) && tabId > 0)),
  );

  await Promise.allSettled(tabIds.map((tabId) => ensureContentScript(tabId)));
}

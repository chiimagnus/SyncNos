import { CONTENT_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { locateAndFlashTextQuote } from '../comments/anchor/text-quote-dom';

export function registerInpageCommentsLocateContentHandlers() {
  const onMessage = (globalThis as any).chrome?.runtime?.onMessage ?? (globalThis as any).browser?.runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const listener = (msg: any, _sender: any, sendResponse: (value: any) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.LOCATE_INPAGE_COMMENT_ANCHOR) return undefined;

    try {
      if (globalThis.top && globalThis.top !== globalThis.self) {
        sendResponse?.({ ok: true, located: false });
        return true;
      }
    } catch (_e) {
      // ignore
    }

    const selector = msg?.payload?.selector || null;
    const located = locateAndFlashTextQuote(selector);
    sendResponse?.({ ok: true, located });
    return true;
  };

  onMessage.addListener(listener);

  return () => {
    try {
      onMessage.removeListener?.(listener);
    } catch (_e) {
      // ignore
    }
  };
}


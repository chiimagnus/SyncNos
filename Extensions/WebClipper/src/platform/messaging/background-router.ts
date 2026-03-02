import { createEventsHub } from '../events/hub';
import { UI_PORT_NAMES } from './message-contracts';

type Message = { type: string; [key: string]: any };

type Handler = (
  msg: Message,
  sender: any,
) => Promise<any> | any;

type RouterOptions = {
  fallback: Handler;
};

function ok(data: unknown) {
  return { ok: true, data, error: null };
}

function err(message: string, extra?: unknown) {
  return { ok: false, data: null, error: { message, extra: extra ?? null } };
}

export function createBackgroundRouter({ fallback }: RouterOptions) {
  const handlers = new Map<string, Handler>();
  const eventsHub = createEventsHub({ portName: UI_PORT_NAMES.POPUP_EVENTS });

  function register(type: string, handler: Handler) {
    if (!type) throw new Error('type is required');
    handlers.set(type, handler);
  }

  async function handleMessage(msg: Message, sender: any) {
    if (!msg || typeof msg.type !== 'string') return err('invalid message');

    const handler = handlers.get(msg.type);
    if (handler) {
      try {
        return await handler(msg, sender);
      } catch (e) {
        return err((e as any)?.message ?? String(e ?? 'handler error'));
      }
    }

    return await fallback(msg, sender);
  }

  function start() {
    // Port subscription keeps SW alive while popup is open (same behavior as legacy router.start()).
    try {
      const rt = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
      rt?.onConnect?.addListener?.((port: any) => {
        eventsHub.registerPort(port);
      });
    } catch (_e) {
      // ignore
    }

    const rt = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
    const onMessage = rt?.onMessage;
    if (!onMessage?.addListener) return;

    // Prefer callback-style listener for maximum compatibility across browsers/polyfills.
    onMessage.addListener((msg: any, sender: any, sendResponse: any) => {
      Promise.resolve()
        .then(() => handleMessage(msg, sender))
        .then((res) => {
          try {
            sendResponse?.(res);
          } catch (_e) {
            // ignore
          }
        })
        .catch((e) => {
          try {
            sendResponse?.(err((e as any)?.message ?? String(e ?? 'unknown error')));
          } catch (_e) {
            // ignore
          }
        });
      return true;
    });
  }

  return { ok, err, register, start, eventsHub };
}

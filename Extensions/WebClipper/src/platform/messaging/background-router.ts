type Message = { type: string; [key: string]: any };

type Handler = (
  msg: Message,
  sender: browser.runtime.MessageSender,
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

  function register(type: string, handler: Handler) {
    if (!type) throw new Error('type is required');
    handlers.set(type, handler);
  }

  async function handleMessage(msg: Message, sender: browser.runtime.MessageSender) {
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
      const NS: any = (globalThis as any).WebClipper || {};
      const hub = NS.backgroundEventsHub;
      const portName = NS.messageContracts?.UI_PORT_NAMES?.POPUP_EVENTS ?? 'popup:events';
      browser.runtime.onConnect.addListener((port) => {
        if (!port || port.name !== portName) return;
        hub?.registerPort?.(port);
      });
    } catch (_e) {
      // ignore
    }

    browser.runtime.onMessage.addListener((msg: any, sender) => {
      return Promise.resolve(handleMessage(msg, sender));
    });
  }

  return { ok, err, register, start };
}


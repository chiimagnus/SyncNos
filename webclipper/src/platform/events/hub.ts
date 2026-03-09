import { UI_PORT_NAMES } from '../messaging/message-contracts';

type PortLike = {
  name?: string;
  postMessage?: (message: unknown) => void;
  onDisconnect?: {
    addListener?: (listener: () => void) => void;
  };
};

type HubOptions = {
  portName?: string;
};

export function createEventsHub(options: HubOptions = {}) {
  const portName = options.portName || UI_PORT_NAMES.POPUP_EVENTS;
  const ports = new Set<PortLike>();

  function cleanupPort(port: PortLike) {
    ports.delete(port);
  }

  function registerPort(port: PortLike) {
    if (!port || !port.postMessage) return false;
    if (port.name !== portName) return false;
    ports.add(port);
    try {
      port.onDisconnect?.addListener?.(() => cleanupPort(port));
    } catch (_e) {
      // ignore
    }
    return true;
  }

  function broadcast(type: string, payload: unknown) {
    const message = { type, payload };
    for (const port of Array.from(ports)) {
      try {
        port.postMessage?.(message);
      } catch (_e) {
        cleanupPort(port);
      }
    }
  }

  return { registerPort, broadcast };
}

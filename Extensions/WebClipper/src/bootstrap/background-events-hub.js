/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const ports = new Set();

  function isPortLike(port) {
    return !!(port
      && typeof port === "object"
      && typeof port.postMessage === "function"
      && port.onDisconnect
      && typeof port.onDisconnect.addListener === "function");
  }

  function registerPort(port) {
    if (!isPortLike(port)) return false;
    ports.add(port);
    try {
      port.onDisconnect.addListener(() => {
        ports.delete(port);
      });
    } catch (_e) {
      ports.delete(port);
      return false;
    }
    return true;
  }

  function broadcast(type, payload) {
    const msgType = String(type || "").trim();
    if (!msgType) return { delivered: 0, pruned: 0 };

    let delivered = 0;
    let pruned = 0;

    for (const port of Array.from(ports)) {
      if (!isPortLike(port)) {
        ports.delete(port);
        pruned += 1;
        continue;
      }
      try {
        port.postMessage({ type: msgType, payload: payload || null });
        delivered += 1;
      } catch (_e) {
        ports.delete(port);
        pruned += 1;
      }
    }

    return { delivered, pruned };
  }

  NS.backgroundEventsHub = {
    registerPort,
    broadcast
  };
})();


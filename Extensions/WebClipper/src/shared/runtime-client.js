/* global chrome */

(function () {
  const NS = require("../runtime-context.js");
  const INVALIDATED_MESSAGE = "Extension context invalidated";
  const INVALIDATED_RE = /Extension context invalidated/i;

  function toError(err, fallbackMessage) {
    if (err instanceof Error) return err;
    return new Error(String(err || fallbackMessage || "Unknown error"));
  }

  function isInvalidContextError(err) {
    const message = String((err && err.message) || err || "");
    return INVALIDATED_RE.test(message);
  }

  function createRuntimeClient() {
    let invalidated = false;
    const invalidatedListeners = new Set();

    function hasRuntime() {
      return Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id);
    }

    function notifyInvalidated(reason) {
      if (invalidated) return;
      invalidated = true;
      const error = toError(reason, INVALIDATED_MESSAGE);
      invalidatedListeners.forEach((listener) => {
        try {
          listener(error);
        } catch (_e) {
          // ignore listener error
        }
      });
    }

    function ensureAvailable() {
      if (invalidated || !hasRuntime()) {
        throw new Error(INVALIDATED_MESSAGE);
      }
    }

    function sendMessage(message) {
      return new Promise((resolve, reject) => {
        try {
          ensureAvailable();
          chrome.runtime.sendMessage(message, (response) => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
              const err = toError(runtimeError.message, "runtime.sendMessage failed");
              if (isInvalidContextError(err)) notifyInvalidated(err);
              reject(err);
              return;
            }
            resolve(response);
          });
        } catch (err) {
          const normalized = toError(err, "runtime.sendMessage failed");
          if (isInvalidContextError(normalized)) notifyInvalidated(normalized);
          reject(normalized);
        }
      });
    }

    function send(type, payload) {
      return sendMessage({ type, ...(payload || {}) });
    }

    function getURL(path) {
      try {
        ensureAvailable();
        return chrome.runtime.getURL(path);
      } catch (err) {
        const normalized = toError(err, "runtime.getURL failed");
        if (isInvalidContextError(normalized)) notifyInvalidated(normalized);
        return "";
      }
    }

    function onInvalidated(listener) {
      if (typeof listener !== "function") return () => {};
      invalidatedListeners.add(listener);
      return () => invalidatedListeners.delete(listener);
    }

    return {
      getURL,
      isInvalidContextError,
      onInvalidated,
      send,
    };
  }

  NS.runtimeClient = {
    createRuntimeClient
  };
})();

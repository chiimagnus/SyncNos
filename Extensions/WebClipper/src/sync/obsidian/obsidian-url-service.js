/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function isObsidianUrl(url) {
    const text = String(url || "").trim();
    return /^obsidian:\/\//i.test(text);
  }

  function openObsidianUrl(url) {
    return new Promise((resolve, reject) => {
      const tabs = chrome && chrome.tabs ? chrome.tabs : null;
      if (!tabs) {
        reject(new Error("tabs api unavailable"));
        return;
      }

      function doneWithRuntimeResult(fallbackMessage) {
        const runtimeError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
        if (runtimeError) {
          reject(new Error(runtimeError.message || fallbackMessage || "open obsidian url failed"));
          return;
        }
        resolve(true);
      }

      if (typeof tabs.update === "function") {
        tabs.update({ url }, () => {
          const updateError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
          if (!updateError) {
            resolve(true);
            return;
          }
          if (typeof tabs.create === "function") {
            tabs.create({ url, active: true }, () => doneWithRuntimeResult("open obsidian url failed"));
            return;
          }
          reject(new Error(updateError.message || "open obsidian url failed"));
        });
        return;
      }

      if (typeof tabs.create === "function") {
        tabs.create({ url, active: true }, () => doneWithRuntimeResult("open obsidian url failed"));
        return;
      }

      reject(new Error("tabs api unavailable"));
    });
  }

  const api = {
    isObsidianUrl,
    openObsidianUrl
  };
  NS.obsidianUrlService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

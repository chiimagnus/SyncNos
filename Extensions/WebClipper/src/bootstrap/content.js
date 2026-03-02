/* global chrome */

(function () {
  const NS = require("../runtime-context.js");
  const runtime = NS.runtimeClient && typeof NS.runtimeClient.createRuntimeClient === "function"
    ? NS.runtimeClient.createRuntimeClient()
    : null;

  try {
    if (NS.inpageButton && typeof NS.inpageButton.initRuntime === "function") {
      NS.inpageButton.initRuntime(runtime);
    }
  } catch (_e) {
    // ignore
  }

  const factory = NS.contentController && typeof NS.contentController.createController === "function"
    ? NS.contentController.createController
    : null;
  if (!factory) return;

  const WEB_INPAGE_VISIBILITY_MESSAGE = "webclipperSetWebInpageEnabled";
  const supportedHostSuffixes = Object.freeze([
    "chat.openai.com",
    "chatgpt.com",
    "www.chatgpt.com",
    "claude.ai",
    "gemini.google.com",
    "chat.deepseek.com",
    "chat.z.ai",
    "kimi.moonshot.cn",
    "kimi.com",
    "doubao.com",
    "yuanbao.tencent.com",
    "poe.com",
    "notion.so"
  ]);

  function isSupportedHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    if (!host) return false;
    for (const suffix of supportedHostSuffixes) {
      if (host === suffix) return true;
      if (host.endsWith(`.${suffix}`)) return true;
    }
    return false;
  }

  const wrapper = factory({ runtime });
  let active = null;

  function startController() {
    try {
      if (!wrapper || typeof wrapper.start !== "function") return null;
      active = wrapper.start();
      return active;
    } catch (_e) {
      active = null;
      return null;
    }
  }

  function stopController() {
    const prev = active;
    active = null;
    try {
      prev && prev.stop && prev.stop();
    } catch (_e) {
      // ignore
    }
  }

  startController();

  // Background dynamically injects/unregisters the generic-web inpage button.
  // For already-injected tabs we support enabling/disabling without a reload.
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === "function") {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || msg.type !== WEB_INPAGE_VISIBILITY_MESSAGE) return;
        // Never disable supported sites; this message targets "generic web" tabs.
        if (isSupportedHost(location && location.hostname)) {
          try {
            sendResponse && sendResponse({ ok: true, ignored: true });
          } catch (_e) {}
          return;
        }

        const enabled = msg.enabled === true;
        if (enabled) {
          if (!active) startController();
        } else {
          if (active) stopController();
        }
        try {
          sendResponse && sendResponse({ ok: true, enabled });
        } catch (_e) {}
      });
    }
  } catch (_e) {
    // ignore
  }
})();

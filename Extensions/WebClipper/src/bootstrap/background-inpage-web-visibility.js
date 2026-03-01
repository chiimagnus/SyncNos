/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const STORAGE_KEY = "inpage_supported_only";
  const DYNAMIC_SCRIPT_ID = "webclipper_inpage_web_dynamic_v1";
  const WEB_INPAGE_VISIBILITY_MESSAGE = "webclipperSetWebInpageEnabled";

  // Keep in sync with manifest supported sites.
  const SUPPORTED_EXCLUDE_MATCHES = Object.freeze([
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://www.chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://chat.deepseek.com/*",
    "https://chat.z.ai/*",
    "https://kimi.moonshot.cn/*",
    "https://kimi.com/*",
    "https://*.kimi.com/*",
    "https://www.doubao.com/*",
    "https://yuanbao.tencent.com/*",
    "https://poe.com/*",
    "https://*.notion.so/*"
  ]);

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

  function parseHttpUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
      const url = new URL(text);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url;
    } catch (_e) {
      return null;
    }
  }

  function canUseScriptingDynamicRegistration() {
    return Boolean(chrome && chrome.scripting
      && typeof chrome.scripting.registerContentScripts === "function"
      && typeof chrome.scripting.unregisterContentScripts === "function");
  }

  function canUseScriptingInjection() {
    return Boolean(chrome && chrome.scripting
      && typeof chrome.scripting.executeScript === "function"
      && typeof chrome.scripting.insertCSS === "function");
  }

  function runtimeLastErrorMessage() {
    return String((chrome && chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) || "");
  }

  function readSetting() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== "function") {
          resolve(false);
          return;
        }
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          resolve(res && res[STORAGE_KEY] === true);
        });
      } catch (_e) {
        resolve(false);
      }
    });
  }

  function getContentAssetsFromManifest() {
    try {
      const manifest = chrome && chrome.runtime && typeof chrome.runtime.getManifest === "function"
        ? chrome.runtime.getManifest()
        : null;
      const entries = manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
      const entry = entries && entries[0] ? entries[0] : null;
      const js = entry && Array.isArray(entry.js) ? entry.js.slice() : [];
      const css = entry && Array.isArray(entry.css) ? entry.css.slice() : [];
      return { js, css };
    } catch (_e) {
      return { js: [], css: [] };
    }
  }

  function getAllTabs() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== "function") return resolve([]);
        chrome.tabs.query({}, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
      } catch (_e) {
        resolve([]);
      }
    });
  }

  function eligibleGenericTabs(tabs) {
    const list = Array.isArray(tabs) ? tabs : [];
    const out = [];
    for (const tab of list) {
      const id = tab && Number(tab.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const url = parseHttpUrl(tab.url);
      if (!url) continue;
      if (isSupportedHost(url.hostname)) continue;
      out.push({ id, url: url.toString() });
    }
    return out;
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== "function") return resolve({ ok: false });
        chrome.tabs.sendMessage(tabId, message, (res) => {
          const err = runtimeLastErrorMessage();
          if (err) return resolve({ ok: false, error: err, response: res || null });
          resolve({ ok: true, response: res || null });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  function injectIntoTab(tabId) {
    return new Promise((resolve) => {
      if (!canUseScriptingInjection()) return resolve({ ok: false, error: "scripting injection unavailable" });
      const { js, css } = getContentAssetsFromManifest();
      if (!js.length) return resolve({ ok: false, error: "content assets missing" });

      const target = { tabId, allFrames: false };
      const tasks = [];

      if (css.length) {
        tasks.push(new Promise((r) => {
          chrome.scripting.insertCSS({ target, files: css }, () => {
            const err = runtimeLastErrorMessage();
            r({ ok: !err, error: err || null });
          });
        }));
      }

      tasks.push(new Promise((r) => {
        chrome.scripting.executeScript({ target, files: js }, () => {
          const err = runtimeLastErrorMessage();
          r({ ok: !err, error: err || null });
        });
      }));

      Promise.all(tasks).then((results) => {
        const firstError = results.find((x) => !x.ok);
        resolve(firstError ? { ok: false, error: firstError.error } : { ok: true });
      });
    });
  }

  function registerDynamicContentScript() {
    return new Promise((resolve) => {
      if (!canUseScriptingDynamicRegistration()) return resolve({ ok: false, error: "dynamic content scripts unavailable" });
      const { js, css } = getContentAssetsFromManifest();
      if (!js.length) return resolve({ ok: false, error: "content assets missing" });

      const def = {
        id: DYNAMIC_SCRIPT_ID,
        matches: ["http://*/*", "https://*/*"],
        excludeMatches: SUPPORTED_EXCLUDE_MATCHES.slice(),
        js,
        css,
        runAt: "document_idle",
        allFrames: false
      };

      chrome.scripting.registerContentScripts([def], () => {
        const err = runtimeLastErrorMessage();
        if (!err) return resolve({ ok: true });
        // If already registered, treat it as success.
        if (/already exists/i.test(err)) return resolve({ ok: true, existed: true });
        resolve({ ok: false, error: err });
      });
    });
  }

  function unregisterDynamicContentScript() {
    return new Promise((resolve) => {
      if (!canUseScriptingDynamicRegistration()) return resolve({ ok: false, error: "dynamic content scripts unavailable" });
      chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] }, () => {
        const err = runtimeLastErrorMessage();
        if (!err) return resolve({ ok: true });
        // If missing, treat it as success.
        if (/not found|no such|unknown/i.test(err)) return resolve({ ok: true, missing: true });
        resolve({ ok: false, error: err });
      });
    });
  }

  async function applyVisibilitySetting({ reason }) {
    const supportedOnly = await readSetting();

    if (supportedOnly) {
      await unregisterDynamicContentScript();
      const tabs = eligibleGenericTabs(await getAllTabs());
      for (const tab of tabs) {
        await sendTabMessage(tab.id, { type: WEB_INPAGE_VISIBILITY_MESSAGE, enabled: false });
      }
      return { ok: true, supportedOnly, reason: reason || "apply" };
    }

    await registerDynamicContentScript();

    const tabs = eligibleGenericTabs(await getAllTabs());
    for (const tab of tabs) {
      const res = await sendTabMessage(tab.id, { type: WEB_INPAGE_VISIBILITY_MESSAGE, enabled: true });
      if (!res.ok) {
        // Tab might not have the script yet; inject immediately for "no refresh" UX.
        await injectIntoTab(tab.id);
      }
    }

    return { ok: true, supportedOnly, reason: reason || "apply" };
  }

  function start() {
    // Ensure registration stays consistent across browser restarts / extension updates.
    // MV3 event listeners are persisted by the browser once registered at least once.
    try {
      if (chrome && chrome.runtime && chrome.runtime.onInstalled && typeof chrome.runtime.onInstalled.addListener === "function") {
        chrome.runtime.onInstalled.addListener(() => {
          applyVisibilitySetting({ reason: "onInstalled" }).catch(() => {});
        });
      }
    } catch (_e) {
      // ignore
    }
    try {
      if (chrome && chrome.runtime && chrome.runtime.onStartup && typeof chrome.runtime.onStartup.addListener === "function") {
        chrome.runtime.onStartup.addListener(() => {
          applyVisibilitySetting({ reason: "onStartup" }).catch(() => {});
        });
      }
    } catch (_e) {
      // ignore
    }

    // Best-effort: keep dynamic registration consistent with persisted setting.
    applyVisibilitySetting({ reason: "startup" }).catch(() => {});

    try {
      if (chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== "local") return;
          if (!changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
          applyVisibilitySetting({ reason: "storageChanged" }).catch(() => {});
        });
      }
    } catch (_e) {
      // ignore
    }
  }

  NS.backgroundInpageWebVisibility = {
    STORAGE_KEY,
    applyVisibilitySetting,
    start
  };
})();

/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const runtime = NS.runtimeClient && typeof NS.runtimeClient.createRuntimeClient === "function"
    ? NS.runtimeClient.createRuntimeClient()
    : null;

  function toErrorMessage(err, fallback) {
    if (!err) return fallback || "Unknown error";
    if (err instanceof Error) return err.message || fallback || "Unknown error";
    if (typeof err === "string") return err;
    return String(err);
  }

  function send(type, payload) {
    if (!runtime || typeof runtime.send !== "function") {
      return Promise.resolve({ ok: false, data: null, error: { message: "runtime client unavailable", extra: null } });
    }
    return runtime.send(type, payload).catch((e) => {
      return { ok: false, data: null, error: { message: toErrorMessage(e, "runtime.sendMessage failed"), extra: null } };
    });
  }

  function storageGet(keys) {
    const normalized = (() => {
      if (typeof keys === "string") return keys;
      if (Array.isArray(keys)) return keys.filter((k) => typeof k === "string" && k);
      if (keys && typeof keys === "object") return keys;
      return [];
    })();
    return new Promise((resolve) => chrome.storage.local.get(normalized, (res) => resolve(res || {})));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  const flashTimers = new WeakMap();

  function flashOk(el, durationMs) {
    if (!el) return;
    const ms = typeof durationMs === "number" ? durationMs : 1400;
    const prev = flashTimers.get(el);
    if (prev) clearTimeout(prev);
    el.classList.add("is-flash-ok");
    const t = setTimeout(() => {
      el.classList.remove("is-flash-ok");
      flashTimers.delete(el);
    }, ms);
    flashTimers.set(el, t);
  }

  const els = {
    appLogo: document.querySelector(".appLogo"),
    list: document.getElementById("list"),
    stats: document.getElementById("stats"),
    tabChats: document.getElementById("tabChats"),
    tabSettings: document.getElementById("tabSettings"),
    tabAbout: document.getElementById("tabAbout"),
    tabIndicator: document.querySelector(".tabs .tabIndicator"),
    viewChats: document.getElementById("viewChats"),
    viewSettings: document.getElementById("viewSettings"),
    viewAbout: document.getElementById("viewAbout"),
    chkSelectAll: document.getElementById("chkSelectAll"),
    btnExport: document.getElementById("btnExport"),
    exportMenu: document.getElementById("exportMenu"),
    menuExportSingleMarkdown: document.getElementById("menuExportSingleMarkdown"),
    menuExportMultiMarkdown: document.getElementById("menuExportMultiMarkdown"),
    menuExportJsons: document.getElementById("menuExportJsons"),
    btnSyncNotion: document.getElementById("btnSyncNotion"),
    btnNotionConnect: document.getElementById("btnNotionConnect"),
    notionStatusTitle: document.getElementById("notionStatusTitle"),
    btnNotionLoadPages: document.getElementById("btnNotionLoadPages"),
    notionPages: document.getElementById("notionPages"),
    aboutVersion: document.getElementById("aboutVersion"),
    btnAboutMacApp: document.getElementById("btnAboutMacApp"),
    btnAboutSource: document.getElementById("btnAboutSource"),
    btnAboutChangelog: document.getElementById("btnAboutChangelog"),
    btnAboutMail: document.getElementById("btnAboutMail"),
    btnAboutGitHub: document.getElementById("btnAboutGitHub")
  };

  const state = {
    conversations: [],
    selectedIds: new Set()
  };

  const STORAGE_KEYS = {
    popupActiveTab: "popup_active_tab"
  };

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_e) {
      return "";
    }
  }

  function getSourceMeta(raw) {
    const text = String(raw || "").trim();
    if (!text) return { key: "unknown", label: "" };
    const normalized = text.toLowerCase().replace(/[\s_-]+/g, "");
    const map = {
      chatgpt: { key: "chatgpt", label: "ChatGPT" },
      claude: { key: "claude", label: "Claude" },
      deepseek: { key: "deepseek", label: "DeepSeek" },
      notionai: { key: "notionai", label: "Notion AI" },
      gemini: { key: "gemini", label: "Gemini" },
      kimi: { key: "kimi", label: "Kimi" },
      doubao: { key: "doubao", label: "Doubao" },
      yuanbao: { key: "yuanbao", label: "Yuanbao" }
    };
    return map[normalized] || { key: "unknown", label: text };
  }

  function isSameLocalDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function hasWarningFlags(conversation) {
    return Array.isArray(conversation.warningFlags) && conversation.warningFlags.length > 0;
  }

  function sanitizeFilenamePart(input, fallback) {
    const text = String(input || "").trim();
    if (!text) return fallback;
    const cleaned = text
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.slice(0, 80) || fallback;
  }

  function downloadBlob({ blob, filename, saveAs }) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: typeof saveAs === "boolean" ? saveAs : false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  async function createZipBlob(files) {
    const api = (globalThis.WebClipper && globalThis.WebClipper.zipUtils) || null;
    if (!api || typeof api.createZipBlob !== "function") {
      throw new Error("ZIP module not available");
    }
    return api.createZipBlob(files);
  }

  function conversationToMarkdown({ conversation, messages }) {
    if (conversation && conversation.sourceType === "article") {
      const api = (globalThis.WebClipper && globalThis.WebClipper.articleMarkdown) || null;
      if (api && typeof api.formatArticleMarkdown === "function") {
        return api.formatArticleMarkdown({ conversation, messages });
      }
    }
    const lines = [];
    lines.push(`# ${conversation.title || "(untitled)"}`);
    lines.push("");
    lines.push(`- Source: ${getSourceMeta(conversation.sourceName || conversation.source || "").label}`);
    if (conversation.url) lines.push(`- URL: ${conversation.url}`);
    if (conversation.lastCapturedAt) lines.push(`- CapturedAt: ${new Date(conversation.lastCapturedAt).toISOString()}`);
    if (hasWarningFlags(conversation)) lines.push(`- Warnings: ${(conversation.warningFlags || []).join(", ")}`);
    lines.push("");
    for (const m of messages || []) {
      const role = m.role || "assistant";
      lines.push(`## ${role}`);
      lines.push("");
      lines.push(String(m.contentText || ""));
      lines.push("");
    }
    return lines.join("\n");
  }

  function openUrl(url) {
    if (!url) return;
    try {
      chrome.tabs.create({ url: String(url) });
    } catch (_e) {
      // ignore
    }
  }

  function disableImageDrag(target) {
    if (!target) return;
    const isImage = target.tagName && String(target.tagName).toLowerCase() === "img";
    const images = isImage ? [target] : (typeof target.querySelectorAll === "function" ? target.querySelectorAll("img") : []);
    for (const image of images) {
      image.setAttribute("draggable", "false");
      image.addEventListener("dragstart", (e) => {
        if (e) e.preventDefault();
      });
    }
  }

  NS.popupCore = {
    runtime,
    send,
    storageGet,
    storageSet,
    flashOk,
    els,
    state,
    STORAGE_KEYS,
    formatTime,
    getSourceMeta,
    isSameLocalDay,
    hasWarningFlags,
    sanitizeFilenamePart,
    downloadBlob,
    createZipBlob,
    conversationToMarkdown,
    openUrl,
    disableImageDrag
  };
})();

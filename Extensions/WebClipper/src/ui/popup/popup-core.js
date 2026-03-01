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
	    chatsMain: document.querySelector("#viewChats .chatsMain"),
	    viewChatsScroll: document.querySelector("#viewChats .viewScroll"),
	    viewSettingsScroll: document.querySelector("#viewSettings .viewScroll"),
	    viewAboutScroll: document.querySelector("#viewAbout .viewScroll"),
	    list: document.getElementById("list"),
	    chatPreviewPopover: document.getElementById("chatPreviewPopover"),
      stats: document.getElementById("stats"),
      chatBottomBar: document.getElementById("chatBottomBar"),
      chatActionButtons: document.getElementById("chatActionButtons"),
      chatBottomSpacer: document.getElementById("chatBottomSpacer"),
      tabChats: document.getElementById("tabChats"),
      tabSettings: document.getElementById("tabSettings"),
      tabAbout: document.getElementById("tabAbout"),
      tabIndicator: document.querySelector(".tabs .tabIndicator"),
      viewChats: document.getElementById("viewChats"),
      viewSettings: document.getElementById("viewSettings"),
      viewAbout: document.getElementById("viewAbout"),
      chkSelectAll: document.getElementById("chkSelectAll"),
      btnDelete: document.getElementById("btnDelete"),
      btnExport: document.getElementById("btnExport"),
      exportMenu: document.getElementById("exportMenu"),
      menuExportSingleMarkdown: document.getElementById("menuExportSingleMarkdown"),
      menuExportMultiMarkdown: document.getElementById("menuExportMultiMarkdown"),
      btnSyncObsidian: document.getElementById("btnSyncObsidian"),
      btnSyncNotion: document.getElementById("btnSyncNotion"),
      sourceFilterSelect: document.getElementById("sourceFilterSelect"),
      btnNotionConnect: document.getElementById("btnNotionConnect"),
      notionStatusTitle: document.getElementById("notionStatusTitle"),
      btnNotionLoadPages: document.getElementById("btnNotionLoadPages"),
      notionPages: document.getElementById("notionPages"),
      btnFetchCurrentArticle: document.getElementById("btnFetchCurrentArticle"),
      articleFetchStatus: document.getElementById("articleFetchStatus"),
      databaseBackupStatus: document.getElementById("databaseBackupStatus"),
	    btnDatabaseExport: document.getElementById("btnDatabaseExport"),
	    databaseImportFile: document.getElementById("databaseImportFile"),
	    btnDatabaseImport: document.getElementById("btnDatabaseImport"),
	    notionAiModelIndex: document.getElementById("notionAiModelIndex"),
	    btnNotionAiModelSave: document.getElementById("btnNotionAiModelSave"),
	    btnNotionAiModelReset: document.getElementById("btnNotionAiModelReset"),
      inpageSupportedOnlyToggle: document.getElementById("inpageSupportedOnlyToggle"),
	    aboutVersion: document.getElementById("aboutVersion"),
	    btnAboutMacApp: document.getElementById("btnAboutMacApp"),
	    btnAboutSource: document.getElementById("btnAboutSource"),
	    btnAboutChangelog: document.getElementById("btnAboutChangelog"),
	    btnAboutMail: document.getElementById("btnAboutMail"),
	    btnAboutGitHub: document.getElementById("btnAboutGitHub")
	  };

  const state = {
    conversations: [],
    allConversations: [],
    selectedIds: new Set(),
    previewCache: new Map(),
    previewRequestToken: 0,
    notionSyncById: new Map(),
    notionSyncInProgress: false,
    obsidianSyncById: new Map(),
    obsidianSyncInProgress: false,
    sourceFilterKey: "all"
  };

  const STORAGE_KEYS = {
    popupActiveTab: "popup_active_tab",
    popupSourceFilterKey: "popup_source_filter_key"
  };

  const PREVIEW_EVENTS = {
    click: "popup:conversation-click"
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
      yuanbao: { key: "yuanbao", label: "Yuanbao" },
      poe: { key: "poe", label: "Poe" },
      zai: { key: "zai", label: "z.ai" },
      web: { key: "web", label: "Web" }
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

  async function copyTextToClipboard(text) {
    const api = (globalThis.WebClipper && globalThis.WebClipper.popupClipboard) || null;
    if (!api || typeof api.copyTextToClipboard !== "function") {
      throw new Error("Clipboard module not available");
    }
    return api.copyTextToClipboard(text);
  }

  function conversationToMarkdown({ conversation, messages }) {
    const kinds = (globalThis.WebClipper && globalThis.WebClipper.conversationKinds) || null;
    const kind = (kinds && typeof kinds.pick === "function") ? kinds.pick(conversation) : null;
    const kindId = kind && kind.id ? String(kind.id) : "";

    if (kindId === "article") {
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
      lines.push(String(m.contentMarkdown || m.contentText || ""));
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

  function sanitizeHttpUrl(url) {
    const text = String(url || "").trim();
    if (!text) return "";
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  }

  function openHttpUrl(url) {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return false;
    try {
      if (chrome && chrome.tabs && typeof chrome.tabs.create === "function") {
        chrome.tabs.create({ url: safeUrl });
        return true;
      }
    } catch (_e) {
      // ignore
    }
    try {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
      return true;
    } catch (_e) {
      return false;
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
    PREVIEW_EVENTS,
    formatTime,
    getSourceMeta,
    isSameLocalDay,
    hasWarningFlags,
    sanitizeFilenamePart,
    downloadBlob,
    createZipBlob,
    copyTextToClipboard,
    conversationToMarkdown,
    openUrl,
    sanitizeHttpUrl,
    openHttpUrl,
    disableImageDrag
  };
})();

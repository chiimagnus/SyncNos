(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore || {};
  const DEFAULT_OBSIDIAN_FOLDER = "SyncNos-AIChats";

  function defaultSanitizeFilenamePart(input, fallback) {
    const text = String(input || "")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
    return String(fallback || "SyncNos Clip");
  }

  function resolveSanitizer(explicitSanitizer) {
    if (typeof explicitSanitizer === "function") return explicitSanitizer;
    if (core && typeof core.sanitizeFilenamePart === "function") return core.sanitizeFilenamePart;
    return defaultSanitizeFilenamePart;
  }

  function isoStampForName(now) {
    const value = now == null ? Date.now() : now;
    return new Date(value).toISOString().replace(/[:.]/g, "-");
  }

  function sanitizeObsidianNoteName(input, fallback, { sanitizeFilenamePart } = {}) {
    const sanitize = resolveSanitizer(sanitizeFilenamePart);
    const raw = sanitize(input || "", fallback || "SyncNos Clip");
    const cleaned = String(raw || fallback || "SyncNos Clip")
      .replace(/\.+$/, "")
      .trim();
    return cleaned || (fallback || "SyncNos Clip");
  }

  function folderForConversation(conversation) {
    const kinds = (globalThis.WebClipper && globalThis.WebClipper.conversationKinds) || null;
    if (kinds && typeof kinds.pick === "function") {
      try {
        const kind = kinds.pick(conversation);
        const folder = kind && kind.obsidian && kind.obsidian.folder ? String(kind.obsidian.folder).trim() : "";
        if (folder) return folder;
      } catch (_e) {
        // ignore
      }
    }
    return DEFAULT_OBSIDIAN_FOLDER;
  }

  function buildObsidianNewUrl({ noteName, markdown, useClipboard, folder }) {
    const targetFolder = String(folder || "").trim() || DEFAULT_OBSIDIAN_FOLDER;
    const filePath = `${targetFolder}/${sanitizeObsidianNoteName(noteName, "SyncNos Clip")}`;
    const pairs = [
      ["file", filePath],
      ["silent", "true"]
    ];
    if (useClipboard) pairs.push(["clipboard", "1"]);
    else pairs.push(["content", String(markdown || "")]);
    const query = pairs
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `obsidian://new?${query}`;
  }

  function createObsidianPayloads(docs, { now, stamp, sanitizeFilenamePart } = {}) {
    const list = Array.isArray(docs) ? docs : [];
    if (!list.length) throw new Error("No conversations selected.");

    const currentStamp = String(stamp || isoStampForName(now));
    const counters = new Map();

    return list.map((doc, index) => {
      const fallback = list.length === 1
        ? `SyncNos-${currentStamp}`
        : `SyncNos-${currentStamp}-${index + 1}`;
      const baseName = sanitizeObsidianNoteName(
        doc && doc.conversation && doc.conversation.title,
        fallback,
        { sanitizeFilenamePart }
      );
      const count = (counters.get(baseName) || 0) + 1;
      counters.set(baseName, count);

      const noteName = count === 1
        ? baseName
        : sanitizeObsidianNoteName(`${baseName}-${count}`, `${fallback}-${count}`, { sanitizeFilenamePart });
      return {
        noteName,
        markdown: String((doc && doc.markdown) || ""),
        folder: folderForConversation(doc && doc.conversation ? doc.conversation : null)
      };
    });
  }

  const api = {
    DEFAULT_OBSIDIAN_FOLDER,
    folderForConversation,
    isoStampForName,
    sanitizeObsidianNoteName,
    buildObsidianNewUrl,
    createObsidianPayloads
  };

  NS.popupObsidian = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

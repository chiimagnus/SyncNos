(function () {
  const { conversationKinds } = require("../../protocols/conversation-kinds.js");
  const NS = require("../../runtime-context.js");

  const DEFAULT_OBSIDIAN_FOLDER = "SyncNos-AIChats";

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function normalizeFolderPath(input) {
    const s = safeString(input);
    if (!s) return "";
    return s
      .replace(/\\/g, "/")
      .split("/")
      .map((seg) => String(seg || "").trim())
      .filter((seg) => !!seg && seg !== "." && seg !== "..")
      .join("/");
  }

  function folderForConversation(conversation, { folderByKindId, defaultFolder } = {}) {
    if (conversationKinds && typeof conversationKinds.pick === "function") {
      try {
        const kind = conversationKinds.pick(conversation);
        const kindId = kind && kind.id ? safeString(kind.id) : "";
        const overrideFolderRaw = kindId && folderByKindId && typeof folderByKindId === "object"
          ? safeString(folderByKindId[kindId])
          : "";
        const overrideFolder = normalizeFolderPath(overrideFolderRaw);
        if (overrideFolder) return overrideFolder;

        const folder = kind && kind.obsidian && kind.obsidian.folder ? safeString(kind.obsidian.folder) : "";
        const normalized = normalizeFolderPath(folder);
        if (normalized) return normalized;
      } catch (_e) {
        // ignore
      }
    }
    const fallback = normalizeFolderPath(defaultFolder);
    return fallback || DEFAULT_OBSIDIAN_FOLDER;
  }

  // FNV-1a 64-bit hash (BigInt) for a stable, short file id.
  function fnv1a64Hex(input) {
    const str = safeString(input);
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= BigInt(str.charCodeAt(i));
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, "0");
  }

  function buildStableNotePath(conversation, opts) {
    const c = conversation || {};
    const source = safeString(c.source) || "unknown";
    const conversationKey = safeString(c.conversationKey) || "unknown";
    const folder = folderForConversation(c, opts);
    const id = fnv1a64Hex(`${source}:${conversationKey}`);
    const filename = `${source}-${id}.md`;
    return folder ? `${folder}/${filename}` : filename;
  }

  NS.obsidianNotePath = {
    DEFAULT_OBSIDIAN_FOLDER,
    folderForConversation,
    fnv1a64Hex,
    normalizeFolderPath,
    buildStableNotePath
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianNotePath;
})();

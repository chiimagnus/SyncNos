(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DEFAULT_OBSIDIAN_FOLDER = "SyncNos-AIChats";

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function folderForConversation(conversation) {
    const kinds = (globalThis.WebClipper && globalThis.WebClipper.conversationKinds) || null;
    if (kinds && typeof kinds.pick === "function") {
      try {
        const kind = kinds.pick(conversation);
        const folder = kind && kind.obsidian && kind.obsidian.folder ? safeString(kind.obsidian.folder) : "";
        if (folder) return folder;
      } catch (_e) {
        // ignore
      }
    }
    return DEFAULT_OBSIDIAN_FOLDER;
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

  function buildStableNotePath(conversation) {
    const c = conversation || {};
    const source = safeString(c.source) || "unknown";
    const conversationKey = safeString(c.conversationKey) || "unknown";
    const folder = folderForConversation(c);
    const id = fnv1a64Hex(`${source}:${conversationKey}`);
    return `${folder}/${source}-${id}.md`;
  }

  NS.obsidianNotePath = {
    DEFAULT_OBSIDIAN_FOLDER,
    folderForConversation,
    fnv1a64Hex,
    buildStableNotePath
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianNotePath;
})();


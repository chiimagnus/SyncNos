(function () {
  const NS = require("../runtime-context.js");

  function normalizeText(text) {
    // Normalization is primarily used for fallback keys/dedupe. Prefer stability over formatting fidelity.
    const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = s.split("\n").map((l) => l.trim());
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function fnv1a32(text) {
    // FNV-1a 32-bit hash, stable and fast enough for dedupe fallback.
    let h = 0x811c9dc5;
    const s = String(text || "");
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function makeFallbackMessageKey({ role, contentText, sequence }) {
    const base = `${role || "assistant"}|${sequence || 0}|${normalizeText(contentText)}`;
    return `fallback_${fnv1a32(base)}`;
  }

  const api = { normalizeText, fnv1a32, makeFallbackMessageKey };

  NS.normalize = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

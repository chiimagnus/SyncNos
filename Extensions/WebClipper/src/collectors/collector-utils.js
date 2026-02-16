(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function conversationKeyFromLocation(loc) {
    try {
      const pathname = loc && typeof loc.pathname === "string" ? loc.pathname : "";
      const href = loc && typeof loc.href === "string" ? loc.href : "";
      return (pathname || "/").replace(/\//g, "_").replace(/^_+/, "") || href.split("?")[0];
    } catch (_e) {
      return "";
    }
  }

  function inEditMode(root) {
    if (!root || !root.querySelector) return false;
    const ta = root.querySelector("textarea");
    if (!ta) return false;
    return document.activeElement === ta || ta.contains(document.activeElement);
  }

  NS.collectorUtils = { conversationKeyFromLocation, inEditMode };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.collectorUtils;
})();


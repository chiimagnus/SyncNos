(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // Task 10 will implement settings UI. This module exists to replace the old URI-based popup-obsidian.js.
  NS.popupObsidianSync = {
    init() {}
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupObsidianSync;
})();


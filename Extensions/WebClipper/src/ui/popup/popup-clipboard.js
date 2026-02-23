(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  async function copyTextToClipboard(text) {
    const content = String(text || "");
    if (!content) throw new Error("Nothing to copy");

    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(content);
        return true;
      }
    } catch (_e) {
      // fall through to legacy fallback
    }

    const ta = document.createElement("textarea");
    ta.value = content;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    const prevFocus = document.activeElement;
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_e) {
      ok = false;
    }
    ta.remove();
    try {
      prevFocus && prevFocus.focus && prevFocus.focus();
    } catch (_e) {
      // ignore
    }
    if (!ok) throw new Error("Copy failed");
    return true;
  }

  NS.popupClipboard = { copyTextToClipboard };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupClipboard;
})();

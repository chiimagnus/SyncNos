/* global setTimeout */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function showSaveTip(text) {
    const id = "webclipper-save-tip";
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = id;
    el.textContent = text;
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "76px";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "10px";
    el.style.fontSize = "12px";
    el.style.color = "#fff";
    el.style.background = "rgba(0,0,0,0.78)";
    el.style.zIndex = "2147483647";
    document.documentElement.appendChild(el);
    setTimeout(() => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 1800);
  }

  NS.inpageTip = { showSaveTip };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.inpageTip;
})();


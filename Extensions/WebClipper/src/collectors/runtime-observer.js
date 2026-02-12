(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function createObserver({ debounceMs, onTick }) {
    const tick = debounce(() => onTick && onTick(), typeof debounceMs === "number" ? debounceMs : 500);
    let mo = null;

    return {
      start() {
        if (mo) return;
        mo = new MutationObserver(() => tick());
        mo.observe(document.documentElement || document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true
        });
        tick();
      },
      stop() {
        if (!mo) return;
        mo.disconnect();
        mo = null;
      }
    };
  }

  NS.runtimeObserver = { createObserver };
})();


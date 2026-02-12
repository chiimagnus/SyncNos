(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const defs = [];

  function register(def) {
    const contract = NS.collectorContract;
    const checked = contract && contract.assertCollectorDef ? contract.assertCollectorDef(def) : def;
    const exists = defs.some((d) => d.id === checked.id);
    if (exists) return false;
    defs.push(checked);
    return true;
  }

  function pickActive(loc) {
    const l = loc || { href: location.href, hostname: location.hostname, pathname: location.pathname };
    for (const d of defs) {
      try {
        if (d.matches(l)) return d;
      } catch (_e) {
        // ignore and continue
      }
    }
    return null;
  }

  function list() {
    return defs.slice();
  }

  const api = { register, pickActive, list };
  NS.collectorsRegistry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


(function () {
  const NS = require("./collector-context.js");

  function assertCollectorDef(def) {
    if (!def || typeof def !== "object") throw new Error("collector def must be an object");
    if (!def.id || typeof def.id !== "string") throw new Error("collector def missing id");
    if (typeof def.matches !== "function") throw new Error(`collector ${def.id} missing matches()`);
    if (!def.collector || typeof def.collector.capture !== "function") throw new Error(`collector ${def.id} missing capture()`);
    return def;
  }

  const api = { assertCollectorDef };
  NS.collectorContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

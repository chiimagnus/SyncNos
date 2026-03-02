(function () {
  const NS = require("../collector-context.js");

  function isHttpUrl(href) {
    const raw = String(href || "").trim();
    if (!raw) return false;
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_e) {
      return false;
    }
  }

  function matches(loc) {
    const href = loc && loc.href ? loc.href : location.href;
    return isHttpUrl(href);
  }

  // This collector exists to enable the inpage button on regular web pages.
  // Actual article extraction is handled by background-side articleFetchService.
  function capture() {
    return null;
  }

  NS.collectors = NS.collectors || {};
  NS.collectors.web = { capture };

  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({
      id: "web",
      matches,
      inpageMatches: matches,
      collector: NS.collectors.web
    });
  }
})();

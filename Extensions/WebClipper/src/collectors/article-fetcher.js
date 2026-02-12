(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function extractMeta(names) {
    for (const name of names) {
      const el =
        document.querySelector(`meta[name='${name}']`) ||
        document.querySelector(`meta[property='${name}']`) ||
        document.querySelector(`meta[name=\"${name}\"]`) ||
        document.querySelector(`meta[property=\"${name}\"]`);
      if (el && el.content) {
        const v = String(el.content || "").trim();
        if (v) return v;
      }
    }
    return "";
  }

  function pickContentRoot() {
    return (
      document.querySelector("article") ||
      document.querySelector("main article") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function extractText(root) {
    const el = root || pickContentRoot();
    const raw = el && (el.innerText || el.textContent) ? (el.innerText || el.textContent) : "";
    const text = NS.normalize && NS.normalize.normalizeText ? NS.normalize.normalizeText(raw) : String(raw || "").trim();
    return text;
  }

  function capture() {
    const root = pickContentRoot();
    const title =
      extractMeta(["og:title", "twitter:title"]) ||
      (document.querySelector("h1") && (document.querySelector("h1").innerText || "").trim()) ||
      (document.title || "").trim();

    const author = extractMeta(["author", "article:author", "og:author"]) || "";
    const publishedAt = extractMeta(["article:published_time", "og:published_time", "pubdate"]) || "";
    const description = extractMeta(["description", "og:description", "twitter:description"]) || "";

    const contentText = extractText(root);
    if (!contentText) return null;

    const url = location.href;
    const conversationKey = `article_${url.split("#")[0]}`;

    return {
      conversation: {
        sourceType: "article",
        source: "article",
        conversationKey,
        title: title || "Untitled",
        url,
        author,
        publishedAt,
        description,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages: [
        {
          messageKey: `article_${NS.normalize && NS.normalize.fnv1a32 ? NS.normalize.fnv1a32(conversationKey) : String(Date.now())}`,
          role: "assistant",
          contentText,
          sequence: 0,
          updatedAt: Date.now()
        }
      ]
    };
  }

  const api = { capture };
  NS.collectors = NS.collectors || {};
  NS.collectors.article = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    // This collector is injected on-demand via chrome.scripting; it should not be in default content_scripts.
    NS.collectorsRegistry.register({ id: "article", matches: () => false, collector: api });
  }
})();


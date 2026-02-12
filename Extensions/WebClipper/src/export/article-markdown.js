(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function formatArticleMarkdown({ conversation, messages }) {
    const c = conversation || {};
    const m0 = Array.isArray(messages) && messages.length ? messages[0] : null;
    const lines = [];
    lines.push(`# ${c.title || "Untitled"}`);
    lines.push("");
    if (c.author) lines.push(`- Author: ${c.author}`);
    if (c.publishedAt) lines.push(`- Published: ${c.publishedAt}`);
    if (c.url) lines.push(`- URL: ${c.url}`);
    if (c.description) lines.push(`- Description: ${c.description}`);
    lines.push("");
    lines.push("## Content");
    lines.push("");
    lines.push(String((m0 && m0.contentText) || ""));
    lines.push("");
    return lines.join("\n");
  }

  const api = { formatArticleMarkdown };
  NS.articleMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


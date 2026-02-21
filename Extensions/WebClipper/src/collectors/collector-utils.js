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

  function isHttpUrl(url) {
    const text = String(url || "").trim();
    return /^https?:\/\//i.test(text);
  }

  function parseSrcset(srcset) {
    const raw = String(srcset || "").trim();
    if (!raw) return [];
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const item of items) {
      const parts = item.split(/\s+/).filter(Boolean);
      const url = parts[0] ? String(parts[0]).trim() : "";
      if (!isHttpUrl(url)) continue;
      const desc = parts[1] ? String(parts[1]).trim() : "";
      let score = 0;
      const m = desc.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
      if (m) {
        score = Number(m[1]) || 0;
        if (String(m[2]).toLowerCase() === "x") score *= 10_000;
      }
      out.push({ url, score });
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out;
  }

  function bestImageUrl(img) {
    if (!img) return "";
    const current = img.currentSrc ? String(img.currentSrc).trim() : "";
    if (isHttpUrl(current)) return current;

    const srcset = img.getAttribute ? img.getAttribute("srcset") : "";
    const fromSet = parseSrcset(srcset);
    if (fromSet.length) return fromSet[0].url;

    const src = img.src ? String(img.src).trim() : (img.getAttribute ? String(img.getAttribute("src") || "").trim() : "");
    if (isHttpUrl(src)) return src;
    return "";
  }

  function extractImageUrlsFromElement(el) {
    if (!el || !el.querySelectorAll) return [];
    const imgs = Array.from(el.querySelectorAll("img"));
    const seen = new Set();
    const out = [];
    for (const img of imgs) {
      const url = bestImageUrl(img);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function appendImageMarkdown(markdown, imageUrls) {
    const base = String(markdown || "").trimEnd();
    const urls = Array.isArray(imageUrls) ? imageUrls.map((u) => String(u || "").trim()).filter(Boolean) : [];
    const normalized = urls.filter((u) => isHttpUrl(u));
    if (!normalized.length) return base;

    const lines = [];
    const already = base;
    for (const url of normalized) {
      if (already && already.includes(url)) continue;
      lines.push(`![](${url})`);
    }
    if (!lines.length) return base;
    if (!base) return lines.join("\n\n");
    return `${base}\n\n${lines.join("\n\n")}`;
  }

  NS.collectorUtils = {
    conversationKeyFromLocation,
    inEditMode,
    extractImageUrlsFromElement,
    appendImageMarkdown
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.collectorUtils;
})();

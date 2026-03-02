(function () {
  const NS = require("../collector-context.js");

  function normalizeMarkdown(markdown) {
    const s = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = s.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeInline(markdown) {
    return normalizeMarkdown(markdown).replace(/\n+/g, " ").trim();
  }

  function normalizeText(value) {
    const text = String(value || "");
    if (NS.normalize && typeof NS.normalize.normalizeText === "function") {
      return NS.normalize.normalizeText(text);
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function wrapInlineCode(text) {
    const s = String(text || "");
    if (!s) return "``";
    const matches = s.match(/`+/g) || [];
    const maxTicks = matches.reduce((m, t) => Math.max(m, t.length), 0);
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    return `${fence}${s}${fence}`;
  }

  function codeFenceDelimiter(content) {
    const runs = String(content || "").match(/`+/g) || [];
    const longest = runs.reduce((max, s) => Math.max(max, s.length), 0);
    return "`".repeat(Math.max(3, longest + 1));
  }

  function normalizeCodeLanguage(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return "";
    if (!/^[a-z0-9_+.-]{1,40}$/.test(value)) return "";
    if (value === "text" || value === "code") return "";
    return value;
  }

  function pickCodeLanguageFromClass(className) {
    const raw = String(className || "");
    if (!raw) return "";
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(language|lang)-([a-z0-9_+.-]+)$/i);
      if (!m || !m[2]) continue;
      const language = normalizeCodeLanguage(m[2]);
      if (language) return language;
    }
    return "";
  }

  function extractTextWithBreaks(node) {
    if (!node) return "";
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function walk(n) {
      if (!n) return "";
      if (n.nodeType === TEXT_NODE) return String(n.nodeValue || "");
      if (n.nodeType !== ELEMENT_NODE) return "";

      const tag = String(n.tagName || "").toLowerCase();
      if (tag === "br") return "\n";
      if (tag === "script" || tag === "style") return "";

      const children = n.childNodes ? Array.from(n.childNodes) : [];
      return children.map((child) => walk(child)).join("");
    }

    return walk(node).replace(/\r\n?/g, "\n");
  }

  function extractPreCodeText(preEl) {
    if (!preEl) return "";
    const codeEl = preEl.querySelector ? preEl.querySelector("code") : null;
    if (codeEl) {
      return String(codeEl.textContent || "").replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
    }
    return String(extractTextWithBreaks(preEl) || "").replace(/\n+$/g, "");
  }

  function detectCodeLanguage(preEl) {
    if (!preEl || !preEl.closest) return "";

    const codeHost = preEl.closest(".segment-code");
    if (codeHost && codeHost.querySelector) {
      const label = codeHost.querySelector(".segment-code-lang");
      const labelText = normalizeCodeLanguage(label && label.textContent ? label.textContent : "");
      if (labelText) return labelText;
    }

    const codeEl = preEl.querySelector ? preEl.querySelector("code") : null;
    const byClass = pickCodeLanguageFromClass(codeEl && codeEl.getAttribute ? codeEl.getAttribute("class") : "");
    if (byClass) return byClass;
    return "";
  }

  function escapeTableCell(text) {
    return String(text || "").replace(/\|/g, "\\|");
  }

  function removeNonContentNodes(container) {
    if (!container || !container.querySelectorAll) return container;

    container.querySelectorAll("button, svg, path, textarea, input, select, option, script, style").forEach((el) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });

    const classSkips = [
      ".segment-code-header",
      ".table-actions",
      ".segment-assistant-actions",
      ".icon-button",
      ".okc-cards-container"
    ];
    for (const selector of classSkips) {
      container.querySelectorAll(selector).forEach((el) => {
        try {
          el.remove();
        } catch (_e) {
          // ignore
        }
      });
    }

    return container;
  }

  function getAssistantContentRoot(wrapper) {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    return wrapper.querySelector(".markdown-container .markdown")
      || wrapper.querySelector(".markdown")
      || wrapper.querySelector(".editor-content")
      || wrapper;
  }

  function sanitizeAssistantClone(wrapper) {
    const root = getAssistantContentRoot(wrapper);
    if (!root || !root.cloneNode) return null;
    try {
      const cloned = root.cloneNode(true);
      removeNonContentNodes(cloned);
      return cloned;
    } catch (_e) {
      return null;
    }
  }

  function extractTextFromSanitizedClone(clone) {
    if (!clone) return "";
    const inner = typeof clone.innerText === "string" ? clone.innerText : "";
    if (inner && inner.trim()) return inner;

    const blockTags = new Set([
      "P",
      "DIV",
      "LI",
      "UL",
      "OL",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
      "PRE",
      "SECTION",
      "ARTICLE",
      "TABLE",
      "TR"
    ]);
    const parts = [];
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function walk(node) {
      if (!node) return;
      const t = node.nodeType;
      if (t === TEXT_NODE) {
        const v = node.nodeValue ? String(node.nodeValue) : "";
        if (v) parts.push(v);
        return;
      }
      if (t !== ELEMENT_NODE) return;

      const tag = node.tagName ? String(node.tagName).toUpperCase() : "";
      if (tag === "BR") {
        parts.push("\n");
        return;
      }

      if (tag === "PRE") {
        const codeText = extractPreCodeText(node);
        if (codeText) parts.push(codeText);
        parts.push("\n\n");
        return;
      }

      const children = node.childNodes ? Array.from(node.childNodes) : [];
      for (const c of children) walk(c);
      if (blockTags.has(tag)) parts.push("\n\n");
    }

    walk(clone);
    return parts.join("");
  }

  function htmlToMarkdown(root) {
    if (!root) return "";
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function renderChildren(el, ctx) {
      const out = [];
      const kids = el && el.childNodes ? Array.from(el.childNodes) : [];
      for (const c of kids) out.push(renderNode(c, ctx));
      return out.join("");
    }

    function renderListItem(li, marker, depth, ctx) {
      const indent = "  ".repeat(Math.max(0, depth));
      const continuationIndent = indent + " ".repeat(marker.length + 1);

      const contentClone = li.cloneNode ? li.cloneNode(true) : null;
      if (contentClone && contentClone.childNodes) {
        const toRemove = [];
        for (const child of Array.from(contentClone.childNodes)) {
          if (!child || !child.tagName) continue;
          const tag = String(child.tagName || "").toLowerCase();
          if (tag === "ul" || tag === "ol") toRemove.push(child);
        }
        for (const n of toRemove) {
          try {
            n.remove();
          } catch (_e) {
            // ignore
          }
        }
      }

      const body = normalizeMarkdown(renderChildren(contentClone || li, ctx)).replace(/\n{2,}/g, "\n");
      const lines = body ? body.split("\n").filter((l) => l.length) : [];
      const out = [];
      if (lines.length) {
        out.push(`${indent}${marker} ${lines[0]}`);
        for (const line of lines.slice(1)) out.push(`${continuationIndent}${line}`);
      } else {
        out.push(`${indent}${marker}`);
      }

      const nestedLists = li && li.querySelectorAll
        ? Array.from(li.querySelectorAll("ul,ol")).filter((listEl) => {
          if (!listEl || !listEl.closest) return false;
          return listEl.closest("li") === li;
        })
        : [];
      for (const nested of nestedLists) {
        const nestedMarkdown = renderList(nested, String(nested.tagName || "").toLowerCase() === "ol", {
          ...ctx,
          listDepth: depth + 1
        }).trimEnd();
        if (nestedMarkdown) out.push(nestedMarkdown);
      }

      return out.join("\n");
    }

    function renderList(listEl, ordered, ctx) {
      const depth = (ctx && Number.isFinite(ctx.listDepth)) ? ctx.listDepth : 0;
      const startValue = Number.parseInt(String(listEl.getAttribute ? listEl.getAttribute("start") || "" : ""), 10);
      const hasStart = Number.isFinite(startValue);

      const items = [];
      const children = listEl && listEl.children ? Array.from(listEl.children) : [];
      let orderedIndex = hasStart ? startValue : 1;
      for (const child of children) {
        if (!child || String(child.tagName || "").toLowerCase() !== "li") continue;
        const marker = ordered ? `${orderedIndex}.` : "-";
        items.push(renderListItem(child, marker, depth, { ...ctx, listDepth: depth }));
        if (ordered) orderedIndex += 1;
      }
      return items.join("\n") + (items.length ? "\n\n" : "");
    }

    function renderBlockquote(el, ctx) {
      const raw = normalizeMarkdown(renderChildren(el, ctx));
      if (!raw) return "";
      const lines = raw.split("\n");
      const quoted = lines.map((l) => {
        const line = String(l || "").replace(/^\s+/g, "");
        return line ? `> ${line}` : ">";
      }).join("\n");
      return `${quoted}\n\n`;
    }

    function renderTable(tableEl, ctx) {
      if (!tableEl || !tableEl.querySelectorAll) return "";
      const rows = Array.from(tableEl.querySelectorAll("tr"));
      if (!rows.length) return "";

      const matrix = rows.map((tr) => {
        const cells = Array.from(tr.children || []).filter((c) => {
          const tag = c && c.tagName ? String(c.tagName).toLowerCase() : "";
          return tag === "th" || tag === "td";
        });
        return cells.map((cell) => escapeTableCell(normalizeInline(renderChildren(cell, ctx))));
      });

      const colCount = Math.max(0, ...matrix.map((r) => r.length));
      if (!colCount || !matrix.length) return "";

      const out = [];
      const header = matrix[0].concat(Array(Math.max(0, colCount - matrix[0].length)).fill(""));
      out.push(`| ${header.join(" | ")} |`);
      out.push(`| ${Array(colCount).fill("---").join(" | ")} |`);
      for (const row of matrix.slice(1)) {
        const padded = row.concat(Array(Math.max(0, colCount - row.length)).fill(""));
        out.push(`| ${padded.join(" | ")} |`);
      }
      return `${out.join("\n")}\n\n`;
    }

    function renderNode(node, ctx) {
      if (!node) return "";
      if (node.nodeType === TEXT_NODE) {
        const raw = node.nodeValue ? String(node.nodeValue) : "";
        if (!raw) return "";
        const collapsed = raw.replace(/\s+/g, " ");
        if (!collapsed.trim()) return "";
        return collapsed;
      }
      if (node.nodeType !== ELEMENT_NODE) return "";

      const tag = node.tagName ? String(node.tagName).toLowerCase() : "";
      if (!tag) return renderChildren(node, ctx);

      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";
      if (tag === "script" || tag === "style" || tag === "svg" || tag === "path" || tag === "button") return "";

      const classText = typeof node.getAttribute === "function" ? String(node.getAttribute("class") || "") : "";
      if (/segment-code-header|table-actions|segment-assistant-actions|icon-button/.test(classText)) return "";

      if (tag === "pre") {
        const text = extractPreCodeText(node);
        if (!text.trim()) return "";
        const lang = detectCodeLanguage(node);
        const fence = codeFenceDelimiter(text);
        return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
      }

      if (tag === "code") return wrapInlineCode(String(node.textContent || ""));
      if (tag === "strong" || tag === "b") return `**${renderChildren(node, ctx)}**`;
      if (tag === "em" || tag === "i") return `*${renderChildren(node, ctx)}*`;
      if (tag === "del" || tag === "s") return `~~${renderChildren(node, ctx)}~~`;

      if (tag === "a") {
        const href = node.getAttribute ? String(node.getAttribute("href") || "") : "";
        const text = normalizeMarkdown(renderChildren(node, ctx));
        if (href && /^https?:\/\//i.test(href)) return `[${text || href}](${href})`;
        return text;
      }

      if (tag === "img") {
        const src = node.getAttribute ? String(node.getAttribute("src") || "").trim() : "";
        if (/^https?:\/\//i.test(src)) return `![](${src})`;
        return "";
      }

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const text = normalizeMarkdown(renderChildren(node, ctx));
        if (!text) return "";
        return `${"#".repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`;
      }

      if (tag === "table") return renderTable(node, ctx);
      if (tag === "ul") return renderList(node, false, ctx);
      if (tag === "ol") return renderList(node, true, ctx);
      if (tag === "blockquote") return renderBlockquote(node, ctx);

      if (tag === "p") {
        const text = normalizeMarkdown(renderChildren(node, ctx));
        return text ? `${text}\n\n` : "";
      }

      if (tag === "li") {
        const text = normalizeMarkdown(renderChildren(node, ctx));
        return text ? `${text}\n` : "";
      }

      if (tag === "div" && /\bparagraph\b/.test(classText)) {
        const text = normalizeMarkdown(renderChildren(node, ctx));
        return text ? `${text}\n\n` : "";
      }

      const rendered = renderChildren(node, ctx);
      if (tag === "div" || tag === "section" || tag === "article" || tag === "span") return rendered;
      return rendered;
    }

    return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
  }

  function extractAssistantMarkdown(wrapper) {
    const cloned = sanitizeAssistantClone(wrapper);
    if (!cloned) return "";
    return htmlToMarkdown(cloned) || "";
  }

  function extractAssistantText(wrapper) {
    const cloned = sanitizeAssistantClone(wrapper);
    if (!cloned) return "";
    return normalizeText(extractTextFromSanitizedClone(cloned));
  }

  const api = {
    removeNonContentNodes,
    normalizeMarkdown,
    extractTextFromSanitizedClone,
    htmlToMarkdown,
    extractAssistantMarkdown,
    extractAssistantText
  };

  NS.kimiMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

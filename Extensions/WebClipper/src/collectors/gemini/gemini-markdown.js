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

  function removeNonContentNodes(container) {
    if (!container || !container.querySelectorAll) return container;

    container.querySelectorAll(".table-footer, [hide-from-message-actions], [aria-hidden='true']").forEach((el) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });

    container.querySelectorAll("svg, path, textarea, input, select, option, script, style").forEach((el) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });

    return container;
  }

  function wrapInlineCode(text) {
    const s = String(text || "");
    if (!s) return "``";
    const matches = s.match(/`+/g) || [];
    const maxTicks = matches.reduce((m, t) => Math.max(m, t.length), 0);
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    return `${fence}${s}${fence}`;
  }

  function pickCodeLanguageFromClass(className) {
    const raw = String(className || "");
    if (!raw) return "";
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(language|lang)-([a-z0-9_#+.-]+)$/i);
      if (m && m[2]) return String(m[2]).toLowerCase();
    }
    return "";
  }

  function pickCodeLanguageFromHeader(preEl) {
    if (!preEl || !preEl.closest || !preEl.querySelector) return "";
    const host = preEl.closest("code-block");
    if (!host || !host.querySelector) return "";
    const label = host.querySelector(".code-block-decoration span");
    const raw = label && label.textContent ? String(label.textContent).trim() : "";
    if (!raw) return "";
    if (!/^[a-z0-9_#+.-]{1,40}$/i.test(raw)) return "";
    return raw.toLowerCase();
  }

  function escapeTableCell(text) {
    return String(text || "").replace(/\|/g, "\\|");
  }

  function getAssistantContentRoot(wrapper) {
    if (!wrapper) return null;
    const selectors = [
      "div.markdown.markdown-main-panel[inline-copy-host][id^='model-response-message-content']",
      "div.markdown.markdown-main-panel[inline-copy-host]",
      "div.markdown-main-panel.preserve-whitespaces-in-response",
      "div.markdown.markdown-main-panel",
      "model-response .model-response-text",
      ".model-response-text"
    ];
    if (wrapper.querySelector) {
      for (const selector of selectors) {
        const node = wrapper.querySelector(selector);
        if (node) return node;
      }
    }
    if (wrapper.classList && wrapper.classList.contains("markdown-main-panel")) return wrapper;
    return wrapper;
  }

  function sanitizeContentClone(wrapper) {
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

    function renderList(listEl, ordered, ctx) {
      const depth = (ctx && Number.isFinite(ctx.listDepth)) ? ctx.listDepth : 0;
      const indent = "  ".repeat(Math.max(0, depth));
      const items = [];
      const children = listEl && listEl.children ? Array.from(listEl.children) : [];
      for (const child of children) {
        if (!child || String(child.tagName || "").toLowerCase() !== "li") continue;
        const childCtx = { ...ctx, listDepth: depth + 1 };
        const body = normalizeMarkdown(renderChildren(child, childCtx)).replace(/\n{2,}/g, "\n");
        const bullet = ordered ? "1." : "-";
        const lines = String(body || "").split("\n").filter((l) => l.length);
        if (!lines.length) continue;
        const first = `${indent}${bullet} ${lines[0]}`;
        const rest = lines.slice(1).map((l) => `${indent}  ${l}`);
        items.push([first, ...rest].join("\n"));
      }
      return items.join("\n") + (items.length ? "\n\n" : "");
    }

    function renderBlockquote(el, ctx) {
      const raw = normalizeMarkdown(renderChildren(el, ctx));
      if (!raw) return "";
      const lines = raw.split("\n");
      const quoted = lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
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
        return node.nodeValue ? String(node.nodeValue) : "";
      }
      if (node.nodeType !== ELEMENT_NODE) return "";

      const tag = node.tagName ? String(node.tagName).toLowerCase() : "";
      if (!tag) return renderChildren(node, ctx);

      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";
      if (tag === "script" || tag === "style" || tag === "svg" || tag === "path" || tag === "button") return "";

      const classText = typeof node.getAttribute === "function" ? String(node.getAttribute("class") || "") : "";
      if (/table-footer|code-block-decoration|buttons/.test(classText)) return "";

      if (tag === "pre") {
        const codeEl = node.querySelector ? node.querySelector("code") : null;
        const className = codeEl && codeEl.getAttribute ? codeEl.getAttribute("class") : "";
        const lang = pickCodeLanguageFromClass(className) || pickCodeLanguageFromHeader(node);
        const text = String((codeEl ? (codeEl.textContent || "") : (node.textContent || "")) || "").replace(/\n+$/g, "");
        if (!text.trim()) return "";
        return `\n\n\`\`\`${lang || ""}\n${text}\n\`\`\`\n\n`;
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

      const rendered = renderChildren(node, ctx);
      if (tag === "div" || tag === "section" || tag === "article" || tag === "response-element" || tag === "code-block") {
        return rendered;
      }
      return rendered;
    }

    return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
  }

  function extractAssistantMarkdown(wrapper) {
    const cloned = sanitizeContentClone(wrapper);
    if (!cloned) return "";
    return htmlToMarkdown(cloned) || "";
  }

  function extractAssistantText(wrapper) {
    const cloned = sanitizeContentClone(wrapper);
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

  NS.geminiMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

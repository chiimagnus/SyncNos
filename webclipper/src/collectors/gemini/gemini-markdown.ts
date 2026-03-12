import { normalizeText as normalizeTextShared } from '../../shared/normalize.ts';
import { replaceMathElementsWithLatexText } from '../formula-utils.ts';

  function normalizeMarkdown(markdown: any): any {
    const s = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = s.split("\n").map((l: any) => l.replace(/[ \t]+$/g, ""));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeInline(markdown: any): any {
    return normalizeMarkdown(markdown).replace(/\n+/g, " ").trim();
  }

  function normalizeText(value: any): any {
    const text = String(value || "");
    return normalizeTextShared(text);
  }

  function removeNonContentNodes(container: any): any {
    if (!container || !container.querySelectorAll) return container;

    container.querySelectorAll(".table-footer, [hide-from-message-actions], [aria-hidden='true']").forEach((el: any) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });

    container.querySelectorAll("svg, path, textarea, input, select, option, script, style").forEach((el: any) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });

    return container;
  }

  function wrapInlineCode(text: any): any {
    const s = String(text || "");
    if (!s) return "``";
    const matches = s.match(/`+/g) || [];
    const maxTicks = matches.reduce((m: any, t: any) => Math.max(m, t.length), 0);
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    return `${fence}${s}${fence}`;
  }

  function pickCodeLanguageFromClass(className: any): any {
    const raw = String(className || "");
    if (!raw) return "";
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(language|lang)-([a-z0-9_#+.-]+)$/i);
      if (m && m[2]) return String(m[2]).toLowerCase();
    }
    return "";
  }

  function pickCodeLanguageFromHeader(preEl: any): any {
    if (!preEl || !preEl.closest || !preEl.querySelector) return "";
    const host = preEl.closest("code-block");
    if (!host || !host.querySelector) return "";
    const label = host.querySelector(".code-block-decoration span");
    const raw = label && label.textContent ? String(label.textContent).trim() : "";
    if (!raw) return "";
    if (!/^[a-z0-9_#+.-]{1,40}$/i.test(raw)) return "";
    return raw.toLowerCase();
  }

  function escapeTableCell(text: any): any {
    return String(text || "").replace(/\|/g, "\\|");
  }

  function getAssistantContentRoot(wrapper: any): any {
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

  function sanitizeContentClone(wrapper: any): any {
    const root = getAssistantContentRoot(wrapper);
    if (!root || !root.cloneNode) return null;

    try {
      const cloned = root.cloneNode(true);
      replaceMathElementsWithLatexText(cloned);
      removeNonContentNodes(cloned);
      return cloned;
    } catch (_e) {
      return null;
    }
  }

  function extractTextFromSanitizedClone(clone: any): any {
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
    const parts: any[] = [];
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function walk(node: any): any {
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

  function htmlToMarkdown(root: any): any {
    if (!root) return "";
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function renderChildren(el: any, ctx: any): any {
      const out = [];
      const kids = el && el.childNodes ? Array.from(el.childNodes) : [];
      for (const c of kids) out.push(renderNode(c, ctx));
      return out.join("");
    }

    function renderList(listEl: any, ordered: any, ctx: any): any {
      const depth = (ctx && Number.isFinite(ctx.listDepth)) ? ctx.listDepth : 0;
      const indent = "  ".repeat(Math.max(0, depth));
      const items: any[] = [];

      const listItems: any[] = [];
      if (listEl && typeof listEl.querySelectorAll === "function" && typeof listEl.closest === "function") {
        const allLis = Array.from(listEl.querySelectorAll("li")) as any[];
        for (const li of allLis) {
          try {
            if (li && typeof li.closest === "function" && li.closest("ul,ol") === listEl) listItems.push(li);
          } catch (_e) {
            // ignore
          }
        }
      } else {
        const children: any[] = listEl && listEl.children ? (Array.from(listEl.children) as any[]) : [];
        for (const child of children) {
          if (!child || String(child.tagName || "").toLowerCase() !== "li") continue;
          listItems.push(child);
        }
      }

      for (const child of listItems) {
        const childCtx = { ...ctx, listDepth: depth + 1 };
        const body = normalizeMarkdown(renderChildren(child, childCtx)).replace(/\n{2,}/g, "\n");
        const bullet = ordered ? "1." : "-";
        const lines = String(body || "").split("\n").filter((l: any) => l.length);
        if (!lines.length) continue;
        const first = `${indent}${bullet} ${lines[0]}`;
        const rest = lines.slice(1).map((l: any) => `${indent}  ${l}`);
        items.push([first, ...rest].join("\n"));
      }
      return items.join("\n") + (items.length ? "\n\n" : "");
    }

    function renderBlockquote(el: any, ctx: any): any {
      const raw = normalizeMarkdown(renderChildren(el, ctx));
      if (!raw) return "";
      const lines = raw.split("\n");
      const quoted = lines.map((l: any) => (l ? `> ${l}` : ">")).join("\n");
      return `${quoted}\n\n`;
    }

    function renderTable(tableEl: any, ctx: any): any {
      if (!tableEl || !tableEl.querySelectorAll) return "";
      const rows = Array.from(tableEl.querySelectorAll("tr"));
      if (!rows.length) return "";

      const matrix = rows.map((tr: any) => {
        const cells = Array.from(tr.children || []).filter((c: any) => {
          const tag = c && c.tagName ? String(c.tagName).toLowerCase() : "";
          return tag === "th" || tag === "td";
        });
        return cells.map((cell: any) => escapeTableCell(normalizeInline(renderChildren(cell, ctx))));
      });

      const colCount = Math.max(0, ...matrix.map((r: any) => r.length));
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

    function renderNode(node: any, ctx: any): any {
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

  function extractAssistantMarkdown(wrapper: any): any {
    const cloned = sanitizeContentClone(wrapper);
    if (!cloned) return "";
    return htmlToMarkdown(cloned) || "";
  }

  function extractAssistantText(wrapper: any): any {
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

export default api;

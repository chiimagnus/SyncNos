(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function texFromKatex(el) {
    if (!el || !el.querySelector) return "";
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    const raw = ann ? (ann.textContent || "") : "";
    return String(raw || "").trim();
  }

  function wrapInlineCode(content) {
    const raw = String(content || "");
    const delimiter = raw.includes("`") ? "``" : "`";
    const cleaned = raw.replace(/\n+/g, " ").trim();
    return `${delimiter}${cleaned}${delimiter}`;
  }

  function elementStyleString(el) {
    if (!el || !el.getAttribute) return "";
    return String(el.getAttribute("style") || "");
  }

  function isBoldEl(el) {
    if (!el) return false;
    const tag = el.tagName ? String(el.tagName).toLowerCase() : "";
    if (tag === "strong" || tag === "b") return true;
    const style = elementStyleString(el);
    return /font-weight\s*:\s*(600|700|800|900)/i.test(style);
  }

  function isItalicEl(el) {
    if (!el) return false;
    const tag = el.tagName ? String(el.tagName).toLowerCase() : "";
    if (tag === "em" || tag === "i") return true;
    const style = elementStyleString(el);
    return /font-style\s*:\s*italic/i.test(style);
  }

  function isStrikeEl(el) {
    if (!el) return false;
    const tag = el.tagName ? String(el.tagName).toLowerCase() : "";
    if (tag === "s" || tag === "del") return true;
    const style = elementStyleString(el);
    return /text-decoration[^;]*line-through/i.test(style);
  }

  function normalizeMarkdownText(value) {
    // Remove zero-width spaces that Notion sometimes injects.
    return String(value || "").replace(/\u200b/g, "");
  }

  function nodeToMarkdown(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return normalizeMarkdownText(node.nodeValue || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node;
    const tag = el.tagName ? String(el.tagName).toLowerCase() : "";

    if (tag === "br") return "\n";

    if (el.classList && el.classList.contains("notion-inline-code-container")) {
      return wrapInlineCode(el.textContent || "");
    }

    if (el.classList && (el.classList.contains("katex") || el.classList.contains("katex-display"))) {
      const tex = texFromKatex(el);
      return tex ? `$${tex}$` : normalizeMarkdownText(el.textContent || "");
    }

    if (tag === "a") {
      const href = String(el.getAttribute("href") || "").trim();
      const text = childrenToMarkdown(el);
      if (/^https?:\/\//i.test(href)) return `[${text || href}](${href})`;
      return text;
    }

    if (tag === "code") {
      return wrapInlineCode(el.textContent || "");
    }

    const inner = childrenToMarkdown(el);
    if (!inner) return "";

    // Apply emphasis wrappers (best-effort). Avoid wrapping whitespace-only.
    const content = inner;
    if (!content.trim()) return content;

    const strike = isStrikeEl(el);
    const bold = isBoldEl(el);
    const italic = isItalicEl(el);

    let out = content;
    if (strike) out = `~~${out}~~`;
    if (bold) out = `**${out}**`;
    if (italic) out = `*${out}*`;
    return out;
  }

  function childrenToMarkdown(el) {
    const parts = [];
    const nodes = el && el.childNodes ? Array.from(el.childNodes) : [];
    for (const n of nodes) {
      const md = nodeToMarkdown(n);
      if (md) parts.push(md);
    }
    return parts.join("");
  }

  function leafToMarkdown(leaf) {
    if (!leaf) return "";
    const raw = childrenToMarkdown(leaf);
    // Keep line breaks, but trim excessive leading/trailing whitespace.
    return normalizeMarkdownText(raw).replace(/[ \t]+\n/g, "\n").trim();
  }

  function getBlockTypeName(block) {
    if (!block || !block.classList) return "";
    for (const c of Array.from(block.classList)) {
      if (!c || !c.startsWith("notion-") || !c.endsWith("-block")) continue;
      return c.slice("notion-".length, -"-block".length);
    }
    return "";
  }

  function isTopLevelBlock(block, scope) {
    let p = block && block.parentElement ? block.parentElement : null;
    while (p && p !== scope) {
      if (p.getAttribute && p.getAttribute("data-block-id")) return false;
      p = p.parentElement;
    }
    return true;
  }

  function blockLeaf(block) {
    if (!block || !block.querySelector) return null;
    return (
      block.querySelector("[data-content-editable-leaf='true']") ||
      block.querySelector("[data-content-editable-leaf=\"true\"]") ||
      null
    );
  }

  function escapeMarkdownTableCell(value) {
    const text = String(value || "").replace(/\n+/g, " ").trim();
    // Escape pipes to avoid breaking table columns.
    return text.replace(/\|/g, "\\|");
  }

  function tableRowsFromHtmlTable(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll("tr"));
    return rows.map((tr) => Array.from(tr.querySelectorAll("th, td")));
  }

  function tableRowsFromRoleGrid(gridEl) {
    const rows = Array.from(gridEl.querySelectorAll("[role='row']"));
    return rows.map((row) => Array.from(row.querySelectorAll("[role='gridcell'],[role='cell'],[role='columnheader'],[role='rowheader']")));
  }

  function cellToMarkdown(cellEl) {
    if (!cellEl) return "";
    const leaf = cellEl.querySelector ? cellEl.querySelector("[data-content-editable-leaf='true']") : null;
    const md = leafToMarkdown(leaf);
    if (md) return md;
    const fallback = cellEl.innerText || cellEl.textContent || "";
    return normalizeMarkdownText(fallback).trim();
  }

  function extractTableMarkdown(block) {
    if (!block || !block.querySelector) return "";

    const table = block.querySelector("table");
    const grid = block.querySelector("[role='grid'],[role='table']");

    let rows = [];
    if (table) rows = tableRowsFromHtmlTable(table);
    else if (grid) rows = tableRowsFromRoleGrid(grid);

    function fallbackToTsv() {
      const raw = String(block.innerText || block.textContent || "");
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length);
      const hasTabs = lines.some((l) => l.includes("\t"));
      if (hasTabs) {
        const matrix = lines.map((l) => l.split("\t").map((c) => escapeMarkdownTableCell(c)));
        const cols = Math.max(0, ...matrix.map((r) => r.length));
        if (cols >= 2 && matrix.length >= 1) {
          const header = matrix[0].concat(Array(Math.max(0, cols - matrix[0].length)).fill(""));
          const sep = Array(cols).fill("---");
          const out = [];
          out.push(`| ${header.join(" | ")} |`);
          out.push(`| ${sep.join(" | ")} |`);
          for (const r of matrix.slice(1)) {
            const row = r.concat(Array(Math.max(0, cols - r.length)).fill(""));
            out.push(`| ${row.join(" | ")} |`);
          }
          return out.join("\n").trim();
        }
      }
      return "";
    }

    // Fallback: try to interpret `innerText` as TSV (Notion often uses tabs between cells).
    if (!rows.length) return fallbackToTsv();

    const matrix = rows.map((cells) => cells.map((cell) => escapeMarkdownTableCell(cellToMarkdown(cell))));
    const cols = Math.max(0, ...matrix.map((r) => r.length));
    if (cols < 2 || matrix.length < 1) return fallbackToTsv();

    const out = [];
    const headerRow = matrix[0].concat(Array(Math.max(0, cols - matrix[0].length)).fill(""));
    const sepRow = Array(cols).fill("---");
    out.push(`| ${headerRow.join(" | ")} |`);
    out.push(`| ${sepRow.join(" | ")} |`);
    for (const r of matrix.slice(1)) {
      const row = r.concat(Array(Math.max(0, cols - r.length)).fill(""));
      out.push(`| ${row.join(" | ")} |`);
    }
    return out.join("\n").trim();
  }

  function blockToMarkdown(block) {
    const type = getBlockTypeName(block);

    const tableMd = extractTableMarkdown(block);
    if (tableMd) return tableMd;

    if (type === "divider") return "---";

    if (type === "equation") {
      const tex = texFromKatex(block);
      if (!tex) return "";
      return `$$\n${tex}\n$$`;
    }

    const leaf = blockLeaf(block);
    const text = leafToMarkdown(leaf);
    if (!text) return "";

    if (type === "header") return `# ${text}`;
    if (type === "sub_header") return `## ${text}`;
    if (type === "sub_sub_header") return `### ${text}`;

    if (type === "quote") {
      const lines = text.split("\n").map((l) => `> ${l}`.trimEnd());
      return lines.join("\n");
    }

    if (type === "bulleted_list") return `- ${text}`;
    if (type === "numbered_list") return `1. ${text}`;
    if (type === "to_do_list") {
      const checked = !!block.querySelector('[role="checkbox"][aria-checked="true"]');
      return `- [${checked ? "x" : " "}] ${text}`;
    }

    if (type === "callout") {
      const lines = text.split("\n").map((l) => `> ${l}`.trimEnd());
      return lines.join("\n");
    }

    return text;
  }

  function blockKind(block) {
    const type = getBlockTypeName(block);
    if (type === "bulleted_list" || type === "numbered_list" || type === "to_do_list") return "list";
    if (type === "quote" || type === "callout") return "quote";
    return "para";
  }

  function extractUserMarkdown(wrapper) {
    const leaf =
      wrapper.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
      wrapper.querySelector("[data-content-editable-leaf='true']");
    const md = leafToMarkdown(leaf);
    return md || "";
  }

  function extractAssistantMarkdown(wrapper) {
    const allBlocks = Array.from(wrapper.querySelectorAll("div[data-block-id]"));
    const blocks = allBlocks.filter((b) => isTopLevelBlock(b, wrapper));
    if (!blocks.length) return "";

    let out = "";
    let prevKind = "";
    for (const b of blocks) {
      const md = blockToMarkdown(b);
      if (!md) continue;
      const kind = blockKind(b);
      if (!out) {
        out = md;
      } else {
        const compact = (prevKind === "list" && kind === "list") || (prevKind === "quote" && kind === "quote");
        out += compact ? `\n${md}` : `\n\n${md}`;
      }
      prevKind = kind;
    }
    return out.trim();
  }

  const api = {
    extractUserMarkdown,
    extractAssistantMarkdown
  };

  NS.notionAiMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


import collectorContext from '../collector-context.ts';

const NS: any = collectorContext as any;

  function isThinkingLabelText(text: any): any {
    const raw = String(text || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (lower === "thinking" || lower === "thinking..." || lower === "thinking…") return true;
    return /^思考(中|过程)?(?:\.{3}|…)?$/.test(raw);
  }

  function removeThinkingNodes(container: any): any {
    if (!container || !container.querySelectorAll) return container;

    const labels: any[] = Array.from(container.querySelectorAll("p, div, span")) as any[];
    for (const label of labels) {
      const hasChildren = !!(label && label.children && label.children.length);
      if (hasChildren) continue;
      const text = label && label.textContent ? label.textContent : "";
      if (!isThinkingLabelText(text)) continue;

      const next = label.nextElementSibling;
      if (next && String(next.tagName || "").toLowerCase() === "blockquote") {
        try {
          next.remove();
        } catch (_e) {
          // ignore
        }
      }

      try {
        label.remove();
      } catch (_e) {
        // ignore
      }
    }
    return container;
  }

  function removeNonContentNodes(container: any): any {
    if (!container || !container.querySelectorAll) return container;
    container.querySelectorAll("button, svg, path, textarea, input, select, option, script, style").forEach((el: any) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });
    return container;
  }

  function normalizeMarkdown(markdown: any): any {
    const s = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = s.split("\n").map((l: any) => l.replace(/[ \t]+$/g, ""));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function pickCodeLanguage(className: any): any {
    const raw = String(className || "");
    if (!raw) return "";
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(language|lang)-([a-z0-9_+-]+)$/i);
      if (m && m[2]) return String(m[2]).toLowerCase();
    }
    return "";
  }

  function wrapInlineCode(text: any): any {
    const s = String(text || "");
    if (!s) return "``";
    const matches = s.match(/`+/g) || [];
    const maxTicks = matches.reduce((m, t) => Math.max(m, t.length), 0);
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    return `${fence}${s}${fence}`;
  }

  function htmlToMarkdown(root: any): any {
    if (!root) return "";
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function renderChildren(el: any, ctx: any): any {
      const out: any[] = [];
      const kids: any[] = el && el.childNodes ? (Array.from(el.childNodes) as any[]) : [];
      for (const c of kids) out.push(renderNode(c, ctx));
      return out.join("");
    }

    function renderList(listEl: any, ordered: any, ctx: any): any {
      const depth = (ctx && Number.isFinite(ctx.listDepth)) ? ctx.listDepth : 0;
      const indent = "  ".repeat(Math.max(0, depth));
      const items: any[] = [];
      const children: any[] = listEl && listEl.children ? (Array.from(listEl.children) as any[]) : [];
      for (const child of children) {
        if (!child || String(child.tagName || "").toLowerCase() !== "li") continue;
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

    function renderNode(node: any, ctx: any): any {
      if (!node) return "";
      if (node.nodeType === TEXT_NODE) return node.nodeValue ? String(node.nodeValue) : "";
      if (node.nodeType !== ELEMENT_NODE) return "";

      const tag = node.tagName ? String(node.tagName).toLowerCase() : "";
      if (!tag) return renderChildren(node, ctx);

      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";
      if (tag === "script" || tag === "style" || tag === "svg" || tag === "path" || tag === "button") return "";

      if (tag === "pre") {
        const codeEl = node.querySelector ? node.querySelector("code") : null;
        const lang = pickCodeLanguage(codeEl && codeEl.getAttribute ? codeEl.getAttribute("class") : "");
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

      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
        const text = normalizeMarkdown(renderChildren(node, ctx));
        if (!text) return "";
        return `${"#".repeat(level)} ${text}\n\n`;
      }

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
      if (tag === "div" || tag === "section" || tag === "article") return rendered;
      return rendered;
    }

    return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
  }

  function extractTextFromSanitizedClone(clone: any): any {
    if (!clone) return "";
    const inner = typeof (clone as any).innerText === "string" ? (clone as any).innerText : "";
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
      "ARTICLE"
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

  function getContentRoot(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    return wrapper.querySelector("div[class*='Markdown_markdownContainer__'] div[class*='Prose_prose__']")
      || wrapper.querySelector("div[class*='Markdown_markdownContainer__']")
      || wrapper.querySelector("div[class*='Message_selectableText__']")
      || wrapper.querySelector("div[class*='Message_messageTextContainer__']")
      || wrapper;
  }

  function sanitizeContentClone(wrapper: any, role: any): any {
    const root = getContentRoot(wrapper);
    if (!root || !root.cloneNode) return null;
    let cloned = null;
    try {
      cloned = root.cloneNode(true);
    } catch (_e) {
      return null;
    }
    if (!cloned) return null;
    removeNonContentNodes(cloned);
    if (role === "assistant") removeThinkingNodes(cloned);
    return cloned;
  }

  function normalizeText(text: any): any {
    const value = String(text || "");
    if (NS.normalize && typeof NS.normalize.normalizeText === "function") {
      return NS.normalize.normalizeText(value);
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function extractMessageMarkdown(wrapper: any, role: any): any {
    const cloned = sanitizeContentClone(wrapper, role);
    if (!cloned) return "";
    return htmlToMarkdown(cloned) || "";
  }

  function extractMessageText(wrapper: any, role: any): any {
    const cloned = sanitizeContentClone(wrapper, role);
    if (!cloned) return "";
    return normalizeText(extractTextFromSanitizedClone(cloned));
  }

  const api = {
    removeThinkingNodes,
    removeNonContentNodes,
    normalizeMarkdown,
    htmlToMarkdown,
    extractTextFromSanitizedClone,
    extractMessageMarkdown,
    extractMessageText
  };

  NS.poeMarkdown = api;

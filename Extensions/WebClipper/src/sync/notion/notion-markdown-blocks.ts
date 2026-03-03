// @ts-nocheck

  const MAX_TEXT = 1900;

  function splitText(text) {
    const s = String(text || "");
    if (s.length <= MAX_TEXT) return [s];
    const parts = [];
    let remaining = s;
    while (remaining.length) {
      if (remaining.length <= MAX_TEXT) {
        parts.push(remaining);
        break;
      }
      let idx = remaining.lastIndexOf("\n", MAX_TEXT);
      if (idx < 0) idx = MAX_TEXT;
      parts.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx).replace(/^\n+/, "");
    }
    return parts;
  }

  function normalizeCodeLanguage(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return "plain text";
    const map = new Map([
      ["text", "plain text"],
      ["plain", "plain text"],
      ["plaintext", "plain text"],
      ["plain text", "plain text"],
      ["js", "javascript"],
      ["ts", "typescript"],
      ["py", "python"],
      ["sh", "shell"],
      ["bash", "shell"],
      ["zsh", "shell"],
      ["c++", "c++"],
      ["cpp", "c++"],
      ["rb", "ruby"],
      ["md", "markdown"]
    ]);
    const normalized = map.get(raw) || raw;
    const allowed = new Set([
      "plain text",
      "markdown",
      "javascript",
      "typescript",
      "python",
      "shell",
      "json",
      "yaml",
      "html",
      "css",
      "swift",
      "go",
      "rust",
      "java",
      "kotlin",
      "c",
      "c++",
      "c#",
      "php",
      "ruby",
      "sql"
    ]);
    return allowed.has(normalized) ? normalized : "plain text";
  }

  function textRich(content, { annotations, link } = {}) {
    const ann = annotations || {};
    const base = {
      bold: !!ann.bold,
      italic: !!ann.italic,
      strikethrough: !!ann.strikethrough,
      underline: !!ann.underline,
      code: !!ann.code,
      color: ann.color || "default"
    };
    const safeLink = link && /^https?:\/\//i.test(String(link)) ? { url: String(link) } : null;
    const text = safeLink ? { content, link: safeLink } : { content };
    return { type: "text", text, annotations: base };
  }

  function equationRich(expression) {
    return { type: "equation", equation: { expression: String(expression || "").trim() } };
  }

  function mergeRichText(list) {
    const out = [];
    for (const item of list || []) {
      if (!item) continue;
      const last = out.length ? out[out.length - 1] : null;
      if (
        last &&
        item.type === "text" &&
        last.type === "text" &&
        String((item.text && item.text.link && item.text.link.url) || "") === String((last.text && last.text.link && last.text.link.url) || "") &&
        JSON.stringify(item.annotations || {}) === JSON.stringify(last.annotations || {})
      ) {
        last.text.content = String(last.text.content || "") + String(item.text && item.text.content ? item.text.content : "");
      } else {
        out.push(item);
      }
    }
    return out;
  }

  function chunkRichText(list) {
    const chunks = [];
    let current = [];
    let currentLen = 0;

    function flush() {
      if (!current.length) return;
      chunks.push(current);
      current = [];
      currentLen = 0;
    }

    for (const item of list || []) {
      if (!item) continue;
      if (item.type !== "text") {
        if (current.length) flush();
        chunks.push([item]);
        continue;
      }
      const content = String(item.text && item.text.content ? item.text.content : "");
      let remaining = content;
      while (remaining.length) {
        const budget = Math.max(1, MAX_TEXT - currentLen);
        const take = remaining.slice(0, budget);
        const nextItem = {
          ...item,
          text: item.text && item.text.link ? { content: take, link: item.text.link } : { content: take }
        };
        current.push(nextItem);
        currentLen += take.length;
        remaining = remaining.slice(take.length);
        if (currentLen >= MAX_TEXT) flush();
      }
    }
    flush();
    return chunks;
  }

  function inlineMarkdownToRichText(markdown, base = {}, link) {
    const src = String(markdown || "");
    if (!src) return [];

    function parseWithCode(input, ann) {
      const m = input.match(/`+/);
      if (!m || m.index === undefined) return parsePlain(input, ann);
      const idx = m.index;
      const fence = m[0];
      const before = input.slice(0, idx);
      const rest = input.slice(idx + fence.length);
      const endIdx = rest.indexOf(fence);
      if (endIdx < 0) return parsePlain(input, ann);
      const codeContent = rest.slice(0, endIdx);
      const after = rest.slice(endIdx + fence.length);
      return [
        ...parsePlain(before, ann),
        textRich(codeContent, { annotations: { ...ann, code: true }, link }),
        ...parseWithCode(after, ann)
      ];
    }

    function parsePlain(input, ann) {
      if (!input) return [];

      const candidates = [];

      const linkIdx = input.indexOf("[");
      if (linkIdx >= 0) candidates.push({ kind: "link", idx: linkIdx, prio: 1 });

      const eqIdx = input.indexOf("$");
      if (eqIdx >= 0) candidates.push({ kind: "equation", idx: eqIdx, prio: 2 });

      const boldIdx = input.indexOf("**");
      if (boldIdx >= 0) candidates.push({ kind: "bold", idx: boldIdx, prio: 3 });

      const strikeIdx = input.indexOf("~~");
      if (strikeIdx >= 0) candidates.push({ kind: "strike", idx: strikeIdx, prio: 4 });

      const italicIdx = input.indexOf("*");
      if (italicIdx >= 0) candidates.push({ kind: "italic", idx: italicIdx, prio: 5 });

      if (!candidates.length) return [textRich(input, { annotations: ann, link })];
      candidates.sort((a, b) => (a.idx - b.idx) || ((a.prio || 9) - (b.prio || 9)));

      const next = candidates[0];
      const before = input.slice(0, next.idx);
      const rest = input.slice(next.idx);
      const out = [];
      if (before) out.push(textRich(before, { annotations: ann, link }));

      if (next.kind === "link") {
        const close = rest.indexOf("](");
        const end = close >= 0 ? rest.indexOf(")", close + 2) : -1;
        if (close >= 0 && end >= 0) {
          const linkText = rest.slice(1, close);
          const url = rest.slice(close + 2, end);
          const tail = rest.slice(end + 1);
          const inner = inlineMarkdownToRichText(linkText, ann, url);
          out.push(...inner);
          out.push(...parsePlain(tail, ann));
          return out;
        }
      }

      if (next.kind === "equation") {
        if (rest.startsWith("$$")) {
          // Block equations are handled by the block parser; keep literal.
        } else {
          const end = rest.indexOf("$", 1);
          if (end > 1) {
            const expr = rest.slice(1, end);
            const tail = rest.slice(end + 1);
            out.push(equationRich(expr));
            out.push(...parsePlain(tail, ann));
            return out;
          }
        }
      }

      if (next.kind === "bold") {
        const end = rest.indexOf("**", 2);
        if (end > 2) {
          const inner = rest.slice(2, end);
          const tail = rest.slice(end + 2);
          out.push(...parsePlain(inner, { ...ann, bold: true }));
          out.push(...parsePlain(tail, ann));
          return out;
        }
      }

      if (next.kind === "strike") {
        const end = rest.indexOf("~~", 2);
        if (end > 2) {
          const inner = rest.slice(2, end);
          const tail = rest.slice(end + 2);
          out.push(...parsePlain(inner, { ...ann, strikethrough: true }));
          out.push(...parsePlain(tail, ann));
          return out;
        }
      }

      if (next.kind === "italic") {
        if (rest.startsWith("**")) {
          // Let bold handler own it.
        } else {
          const end = rest.indexOf("*", 1);
          if (end > 1) {
            const inner = rest.slice(1, end);
            const tail = rest.slice(end + 1);
            out.push(...parsePlain(inner, { ...ann, italic: true }));
            out.push(...parsePlain(tail, ann));
            return out;
          }
        }
      }

      out.push(textRich(rest.slice(0, 1), { annotations: ann, link }));
      out.push(...parsePlain(rest.slice(1), ann));
      return out;
    }

    return mergeRichText(parseWithCode(src, base));
  }

  function blocksFromInlineRichText(type, richText) {
    const merged = mergeRichText(richText);
    const chunks = chunkRichText(merged);
    const blocks = [];
    for (const c of chunks) {
      if (!c || !c.length) continue;
      if (type === "paragraph") {
        blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: c } });
      } else if (type === "quote") {
        blocks.push({ object: "block", type: "quote", quote: { rich_text: c } });
      } else if (type === "bulleted_list_item") {
        blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: c } });
      } else if (type === "numbered_list_item") {
        blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: c } });
      } else if (type === "to_do") {
        blocks.push({ object: "block", type: "to_do", to_do: { rich_text: c, checked: false } });
      } else if (type === "heading_1") {
        blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: c } });
      } else if (type === "heading_2") {
        blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: c } });
      } else if (type === "heading_3") {
        blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: c } });
      }
    }
    return blocks;
  }

  function markdownToNotionBlocks(markdown) {
    const src = String(markdown || "").replace(/\r\n/g, "\n");
    const lines = src.split("\n");
    const out = [];

    function isBlank(line) {
      return !String(line || "").trim();
    }

    function isHttpUrl(url) {
      return /^https?:\/\//i.test(String(url || "").trim());
    }

    function startsWithFence(line) {
      return String(line || "").trimStart().startsWith("```");
    }

    function fenceLang(line) {
      const t = String(line || "").trimStart();
      return t.slice(3).trim();
    }

    function pushCodeBlock(language, content) {
      const lang = normalizeCodeLanguage(language);
      const parts = splitText(content);
      for (const p of parts) {
        if (!String(p || "").length) continue;
        out.push({
          object: "block",
          type: "code",
          code: { rich_text: [textRich(p, { annotations: { code: true } })], language: lang }
        });
      }
    }

    function pushEquationBlock(expression) {
      const expr = String(expression || "").trim();
      if (!expr) return;
      out.push({ object: "block", type: "equation", equation: { expression: expr } });
    }

    function parseImageLine(line) {
      const trimmed = String(line || "").trim();
      const m = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)\s*$/);
      if (!m) return null;
      const url = String(m[2] || "").trim();
      if (!isHttpUrl(url)) return null;
      return { url, alt: String(m[1] || "") };
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = String(line || "").trim();

      if (isBlank(line)) {
        i += 1;
        continue;
      }

      if (trimmed === "---") {
        out.push({ object: "block", type: "divider", divider: {} });
        i += 1;
        continue;
      }

      if (startsWithFence(line)) {
        const lang = fenceLang(line);
        i += 1;
        const codeLines = [];
        while (i < lines.length && !startsWithFence(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length && startsWithFence(lines[i])) i += 1;
        pushCodeBlock(lang, codeLines.join("\n"));
        continue;
      }

      if (trimmed === "$$") {
        i += 1;
        const exprLines = [];
        while (i < lines.length && String(lines[i] || "").trim() !== "$$") {
          exprLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length && String(lines[i] || "").trim() === "$$") i += 1;
        pushEquationBlock(exprLines.join("\n"));
        continue;
      }

      if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
        pushEquationBlock(trimmed.slice(2, -2));
        i += 1;
        continue;
      }

      const image = parseImageLine(line);
      if (image) {
        out.push({
          object: "block",
          type: "image",
          image: { type: "external", external: { url: image.url } }
        });
        i += 1;
        continue;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const text = heading[2];
        const rich = inlineMarkdownToRichText(text);
        const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
        out.push(...blocksFromInlineRichText(type, rich));
        i += 1;
        continue;
      }

      if (trimmed.startsWith(">")) {
        const quoteLines = [];
        while (i < lines.length && String(lines[i] || "").trim().startsWith(">")) {
          quoteLines.push(String(lines[i] || "").replace(/^\s*>\s?/, ""));
          i += 1;
        }
        const rich = inlineMarkdownToRichText(quoteLines.join("\n"));
        out.push(...blocksFromInlineRichText("quote", rich));
        continue;
      }

      const todo = trimmed.match(/^-\s+\[(x| )\]\s+(.+)$/i);
      if (todo) {
        const checked = String(todo[1] || "").toLowerCase() === "x";
        const rich = inlineMarkdownToRichText(todo[2] || "");
        const blocks = blocksFromInlineRichText("to_do", rich);
        for (const b of blocks) {
          if (b && b.type === "to_do") b.to_do.checked = checked;
        }
        out.push(...blocks);
        i += 1;
        continue;
      }

      const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
      if (bullet) {
        const rich = inlineMarkdownToRichText(bullet[1] || "");
        out.push(...blocksFromInlineRichText("bulleted_list_item", rich));
        i += 1;
        continue;
      }

      const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numbered) {
        const rich = inlineMarkdownToRichText(numbered[1] || "");
        out.push(...blocksFromInlineRichText("numbered_list_item", rich));
        i += 1;
        continue;
      }

      const paraLines = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        const nextTrim = String(next || "").trim();
        if (
          isBlank(next) ||
          nextTrim === "---" ||
          startsWithFence(next) ||
          nextTrim === "$$" ||
          nextTrim.match(/^(#{1,3})\s+/) ||
          nextTrim.startsWith(">") ||
          nextTrim.match(/^-\s+\[(x| )\]\s+/i) ||
          nextTrim.match(/^[-*+]\s+/) ||
          nextTrim.match(/^\d+\.\s+/)
        ) {
          break;
        }
        paraLines.push(next);
        i += 1;
      }
      const paraText = paraLines.join("\n");
      const rich = inlineMarkdownToRichText(paraText);
      out.push(...blocksFromInlineRichText("paragraph", rich));
    }

    return out;
  }

const api = {
  inlineMarkdownToRichText,
  markdownToNotionBlocks,
};

export { inlineMarkdownToRichText, markdownToNotionBlocks };
export default api;

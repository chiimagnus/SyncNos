(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const MAX_TEXT = 1900;
  const APPEND_BATCH = 90;
  const RATE_DELAY_MS = 250;

  function aiLabelForSource(source) {
    const api = NS.notionAi;
    if (api && typeof api.optionNameForSource === "function") return api.optionNameForSource(source);
    const fallback = String(source || "").trim();
    return fallback || "Unknown";
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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

  function textBlock(content) {
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content } }]
      }
    };
  }

  function headingBlock(label, color) {
    return {
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: label } }],
        color: color || "default"
      }
    };
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
        // Keep non-text (equation) as its own item; if too big, Notion will reject anyway.
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

      // Fallback: emit the marker char(s) as plain text and continue.
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
        // `checked` is attached by the caller.
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
        // Consume closing fence if present.
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

      // Paragraph: consume until next blank or block marker.
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

  function messagesToBlocks(messages, options) {
    const out = [];
    const source = options && options.source ? String(options.source) : "";
    for (const m of messages || []) {
      const role = m.role || "assistant";
      const label = role === "user" ? "User" : role === "assistant" ? "Assistant" : role;
      out.push(headingBlock(label, role === "user" ? "green" : "blue_background"));
      const markdown = (m && m.contentMarkdown && String(m.contentMarkdown).trim()) ? String(m.contentMarkdown) : "";
      if (markdown) {
        const blocks = markdownToNotionBlocks(markdown);
        if (blocks.length) out.push(...blocks);
        else {
          const parts = splitText(m.contentText || "");
          for (const p of parts) out.push(textBlock(p));
        }
      } else {
        const parts = splitText(m.contentText || "");
        for (const p of parts) out.push(textBlock(p));
      }
    }
    return out;
  }

  async function listChildren(accessToken, blockId) {
    const out = [];
    let cursor = null;
    for (;;) {
      const qs = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(String(cursor))}` : "?page_size=100";
      // eslint-disable-next-line no-await-in-loop
      const res = await NS.notionApi.notionFetch({
        accessToken,
        method: "GET",
        path: `/v1/blocks/${blockId}/children${qs}`
      });
      const results = Array.isArray(res && res.results) ? res.results : [];
      out.push(...results);
      if (!res || !res.has_more) break;
      cursor = res.next_cursor || null;
      if (!cursor) break;
    }
    return out;
  }

  async function archiveBlock(accessToken, blockId) {
    // Notion uses DELETE to archive blocks.
    return NS.notionApi.notionFetch({ accessToken, method: "DELETE", path: `/v1/blocks/${blockId}` });
  }

  async function clearPageChildren(accessToken, pageId) {
    const children = await listChildren(accessToken, pageId);
    for (const c of children) {
      if (!c || !c.id) continue;
      await archiveBlock(accessToken, c.id);
      await sleep(RATE_DELAY_MS);
    }
  }

  async function appendChildren(accessToken, pageId, blocks) {
    let remaining = Array.isArray(blocks) ? blocks.slice() : [];
    while (remaining.length) {
      const batch = remaining.slice(0, APPEND_BATCH);
      remaining = remaining.slice(APPEND_BATCH);
      await NS.notionApi.notionFetch({
        accessToken,
        method: "PATCH",
        path: `/v1/blocks/${pageId}/children`,
        body: { children: batch }
      });
      if (remaining.length) await sleep(RATE_DELAY_MS);
    }
  }

  function buildPagePropertiesForCreate({ title, url, ai }) {
    const props = {
      Name: { title: [{ type: "text", text: { content: title || "Untitled" } }] },
      Date: { date: { start: new Date().toISOString() } },
      URL: { url: url || "" }
    };
    const aiName = aiLabelForSource(ai);
    if (aiName) props.AI = { multi_select: [{ name: aiName }] };
    return props;
  }

  function buildPagePropertiesForUpdate({ title, url, ai }) {
    const props = {
      Name: { title: [{ type: "text", text: { content: title || "Untitled" } }] },
      URL: { url: url || "" }
    };
    const aiName = aiLabelForSource(ai);
    if (aiName) props.AI = { multi_select: [{ name: aiName }] };
    return props;
  }

  async function createPageInDatabase(accessToken, { databaseId, title, url, ai }) {
    const body = {
      parent: { database_id: databaseId },
      properties: buildPagePropertiesForCreate({ title, url, ai })
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/pages", body });
  }

  async function updatePageProperties(accessToken, { pageId, title, url, ai }) {
    const body = {
      properties: buildPagePropertiesForUpdate({ title, url, ai })
    };
    return NS.notionApi.notionFetch({ accessToken, method: "PATCH", path: `/v1/pages/${pageId}`, body });
  }

  async function getPage(accessToken, pageId) {
    return NS.notionApi.notionFetch({ accessToken, method: "GET", path: `/v1/pages/${pageId}` });
  }

  function isPageArchivedOrTrashed(page) {
    try {
      if (!page || typeof page !== "object") return true;
      if (page.archived === true) return true;
      if (page.in_trash === true) return true;
      return false;
    } catch (_e) {
      return true;
    }
  }

  function isPageUsableForDatabase(page, databaseId) {
    if (!pageBelongsToDatabase(page, databaseId)) return false;
    if (isPageArchivedOrTrashed(page)) return false;
    return true;
  }

  function pageBelongsToDatabase(page, databaseId) {
    try {
      const parent = page && page.parent ? page.parent : null;
      if (!parent || parent.type !== "database_id") return false;
      return parent.database_id === databaseId;
    } catch (_e) {
      return false;
    }
  }

  function hasExternalImageBlocks(blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    return list.some((b) => b && b.type === "image" && b.image && b.image.type === "external" && b.image.external && b.image.external.url);
  }

  function sanitizeUrlForLog(url) {
    try {
      const u = new URL(String(url || ""));
      const keys = [];
      for (const [k] of u.searchParams.entries()) keys.push(k);
      const uniqueKeys = Array.from(new Set(keys));
      const q = uniqueKeys.length ? `?keys=${uniqueKeys.slice(0, 12).join(",")}` : "";
      return `${u.origin}${u.pathname}${q}`;
    } catch (_e) {
      return String(url || "").slice(0, 120);
    }
  }

  function guessContentTypeFromUrl(url) {
    const s = String(url || "").toLowerCase();
    if (s.includes(".png")) return "image/png";
    if (s.includes(".jpg") || s.includes(".jpeg")) return "image/jpeg";
    if (s.includes(".webp")) return "image/webp";
    if (s.includes(".gif")) return "image/gif";
    if (s.includes(".svg")) return "image/svg+xml";
    return "";
  }

  function guessFilenameFromUrl(url) {
    try {
      const u = new URL(String(url || ""));
      const last = String(u.pathname || "").split("/").filter(Boolean).pop() || "";
      if (last && last.includes(".")) return last.slice(0, 120);
    } catch (_e) {
      // ignore
    }
    return "image.jpg";
  }

  async function downloadBytes(url) {
    if (typeof fetch !== "function") throw new Error("fetch missing");
    const target = String(url || "").trim();
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" }
    });
    if (!res.ok) throw new Error(`image download failed HTTP ${res.status}`);
    const ct = res.headers && res.headers.get ? String(res.headers.get("content-type") || "") : "";
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return { bytes, contentType: ct.split(";")[0].trim(), contentLength: bytes.byteLength };
  }

  async function upgradeImageBlocksToFileUploads(accessToken, blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (!list.length) return [];
    const files = NS.notionFilesApi;
    if (
      !files ||
      typeof files.createExternalURLUpload !== "function" ||
      typeof files.waitUntilUploaded !== "function" ||
      typeof files.createFileUpload !== "function" ||
      typeof files.uploadBytesToUploadUrl !== "function" ||
      typeof files.completeUpload !== "function"
    ) {
      return list;
    }

    const cache = new Map();
    const out = [];
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

    for (const b of list) {
      if (!b || b.type !== "image" || !b.image || b.image.type !== "external") {
        out.push(b);
        continue;
      }
      const url = b.image && b.image.external && b.image.external.url ? String(b.image.external.url).trim() : "";
      if (!url) {
        out.push(b);
        continue;
      }

      let uploadId = cache.get(url) || "";
      if (!uploadId) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const created = await files.createExternalURLUpload({ accessToken, url });
          const id = created && created.id ? String(created.id).trim() : "";
          if (!id) throw new Error("missing file upload id");
          // eslint-disable-next-line no-await-in-loop
          const ready = await files.waitUntilUploaded({ accessToken, id });
          uploadId = ready && ready.id ? String(ready.id).trim() : id;
          if (uploadId) cache.set(url, uploadId);
        } catch (e) {
          const brief = sanitizeUrlForLog(url);
          const msg = e && e.message ? String(e.message) : String(e);
          try {
            console.warn("[NotionImageUpload] external_url failed:", brief, msg);
          } catch (_e2) {
            // ignore
          }

          try {
            // eslint-disable-next-line no-await-in-loop
            const dl = await downloadBytes(url);
            if (!dl || !(dl.bytes instanceof Uint8Array) || !dl.bytes.byteLength) throw new Error("download empty");
            if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${dl.bytes.byteLength}`);
            const ct = dl.contentType || guessContentTypeFromUrl(url) || "application/octet-stream";
            const filename = guessFilenameFromUrl(url);

            // eslint-disable-next-line no-await-in-loop
            const up = await files.createFileUpload({
              accessToken,
              filename,
              contentType: ct,
              contentLength: dl.bytes.byteLength
            });
            const uploadUrl = up && up.upload_url ? String(up.upload_url).trim() : "";
            const fileId = up && up.id ? String(up.id).trim() : "";
            if (!uploadUrl || !fileId) throw new Error("missing upload_url");

            // eslint-disable-next-line no-await-in-loop
            await files.uploadBytesToUploadUrl({ uploadUrl, bytes: dl.bytes, contentType: ct });
            // eslint-disable-next-line no-await-in-loop
            await files.completeUpload({ accessToken, id: fileId });
            // eslint-disable-next-line no-await-in-loop
            const ready = await files.waitUntilUploaded({ accessToken, id: fileId });
            uploadId = ready && ready.id ? String(ready.id).trim() : fileId;
            if (uploadId) cache.set(url, uploadId);
          } catch (e2) {
            const msg2 = e2 && e2.message ? String(e2.message) : String(e2);
            try {
              console.warn("[NotionImageUpload] byte upload failed:", brief, msg2);
            } catch (_e3) {
              // ignore
            }
            uploadId = "";
          }
        }
      }

      if (!uploadId) {
        out.push(b);
        continue;
      }

      out.push({
        ...b,
        type: "image",
        image: {
          type: "file_upload",
          file_upload: { id: uploadId }
        }
      });
    }

    return out;
  }

  const api = {
    messagesToBlocks,
    markdownToNotionBlocks,
    inlineMarkdownToRichText,
    clearPageChildren,
    appendChildren,
    createPageInDatabase,
    updatePageProperties,
    getPage,
    isPageArchivedOrTrashed,
    isPageUsableForDatabase,
    pageBelongsToDatabase,
    hasExternalImageBlocks,
    upgradeImageBlocksToFileUploads,
    aiLabelForSource
  };

  NS.notionSyncService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

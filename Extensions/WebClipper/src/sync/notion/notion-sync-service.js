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

  let markdownBlocksApi = null;

  function getMarkdownBlocksApi() {
    if (markdownBlocksApi) return markdownBlocksApi;
    const globalApi = NS.notionMarkdownBlocks;
    if (
      globalApi &&
      typeof globalApi.inlineMarkdownToRichText === "function" &&
      typeof globalApi.markdownToNotionBlocks === "function"
    ) {
      markdownBlocksApi = globalApi;
      return markdownBlocksApi;
    }
    if (typeof require === "function") {
      try {
        // Node/Vitest fallback when module load order differs from extension runtime.
        const required = require("./notion-markdown-blocks.js");
        if (
          required &&
          typeof required.inlineMarkdownToRichText === "function" &&
          typeof required.markdownToNotionBlocks === "function"
        ) {
          markdownBlocksApi = required;
          return markdownBlocksApi;
        }
      } catch (_e) {
        // ignore
      }
    }
    return null;
  }

  function inlineMarkdownToRichText(markdown, base = {}, link) {
    const api = getMarkdownBlocksApi();
    if (api && typeof api.inlineMarkdownToRichText === "function") {
      return api.inlineMarkdownToRichText(markdown, base, link);
    }
    const content = String(markdown || "");
    if (!content) return [];
    return [{ type: "text", text: { content }, annotations: { ...base } }];
  }

  function markdownToNotionBlocks(markdown) {
    const api = getMarkdownBlocksApi();
    if (api && typeof api.markdownToNotionBlocks === "function") {
      return api.markdownToNotionBlocks(markdown);
    }
    const content = String(markdown || "").trim();
    if (!content) return [];
    return [{
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content } }] }
    }];
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
    let credentials = "include";
    try {
      const u = new URL(target);
      // Attachment URLs may require Notion auth cookies on `notion.so`.
      // The redirected CDN (`notionusercontent.com`) should work without credentials.
      if (/(\.|^)notionusercontent\.com$/i.test(u.hostname)) credentials = "omit";
    } catch (_e) {
      // ignore
    }
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      credentials,
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" }
    });
    if (!res.ok) {
      const finalUrl = res && res.url ? String(res.url) : target;
      throw new Error(`image download failed HTTP ${res.status} ${sanitizeUrlForLog(finalUrl)}`);
    }
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
      typeof files.sendFileUpload !== "function"
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
              contentType: ct
            });
            const fileId = up && up.id ? String(up.id).trim() : "";
            if (!fileId) throw new Error("missing file upload id");

            // eslint-disable-next-line no-await-in-loop
            await files.sendFileUpload({ accessToken, id: fileId, bytes: dl.bytes, filename, contentType: ct });
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

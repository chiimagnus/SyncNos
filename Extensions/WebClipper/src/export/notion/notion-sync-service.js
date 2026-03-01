(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const MAX_TEXT = 1900;
  const APPEND_BATCH = 90;
  const APPEND_RATE_DELAY_MS = 250;
  const CLEAR_DELETE_CONCURRENCY = 3;
  const CLEAR_DELETE_MAX_ATTEMPTS = 5;

  function aiLabelForSource(source) {
    const api = NS.notionAi;
    if (api && typeof api.optionNameForSource === "function") return api.optionNameForSource(source);
    const fallback = String(source || "").trim();
    return fallback || "Unknown";
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function parseHttpStatus(error) {
    const raw = error && error.status != null ? Number(error.status) : NaN;
    if (Number.isFinite(raw) && raw > 0) return raw;
    const message = error && error.message ? String(error.message) : String(error || "");
    const m = message.match(/\bHTTP\s+(\d{3})\b/i);
    return m ? Number(m[1]) : 0;
  }

  function retryDelayMs(error, attempt) {
    const retryAfterMs = error && error.retryAfterMs != null ? Number(error.retryAfterMs) : 0;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(5000, Math.max(150, Math.round(retryAfterMs)));
    }
    const a = Number.isFinite(Number(attempt)) ? Math.max(1, Number(attempt)) : 1;
    const base = 180 * (2 ** (a - 1));
    const jitter = Math.floor(Math.random() * 120);
    return Math.min(5000, base + jitter);
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
  let imageUploadUpgraderApi = null;

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

  function getImageUploadUpgraderApi() {
    if (imageUploadUpgraderApi) return imageUploadUpgraderApi;
    const globalApi = NS.notionImageUploadUpgrader;
    if (globalApi && typeof globalApi.upgradeImageBlocksToFileUploads === "function") {
      imageUploadUpgraderApi = globalApi;
      return imageUploadUpgraderApi;
    }
    if (typeof require === "function") {
      try {
        // Node/Vitest fallback when module load order differs from extension runtime.
        const required = require("./notion-image-upload-upgrader.js");
        if (required && typeof required.upgradeImageBlocksToFileUploads === "function") {
          imageUploadUpgraderApi = required;
          return imageUploadUpgraderApi;
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

  function messagesToBlocks(messages, _options) {
    const out = [];
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

  async function archiveBlockWithRetry(accessToken, blockId) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        return await archiveBlock(accessToken, blockId);
      } catch (error) {
        const status = parseHttpStatus(error);
        const retryable = status === 429 || status === 503;
        if (!retryable || attempt >= CLEAR_DELETE_MAX_ATTEMPTS) throw error;
        // eslint-disable-next-line no-await-in-loop
        await sleep(retryDelayMs(error, attempt));
      }
    }
  }

  async function parallelEach(items, worker, concurrency) {
    const queue = Array.isArray(items) ? items.slice() : [];
    if (!queue.length) return true;
    const size = Number.isFinite(Number(concurrency)) ? Math.max(1, Number(concurrency)) : 1;
    const workers = [];
    for (let i = 0; i < size; i += 1) {
      workers.push((async () => {
        for (;;) {
          const item = queue.shift();
          if (item == null) return;
          // eslint-disable-next-line no-await-in-loop
          await worker(item);
        }
      })());
    }
    await Promise.all(workers);
    return true;
  }

  async function clearPageChildren(accessToken, pageId) {
    const children = await listChildren(accessToken, pageId);
    const ids = children
      .map((c) => c && c.id ? String(c.id).trim() : "")
      .filter(Boolean);
    await parallelEach(ids, async (blockId) => {
      await archiveBlockWithRetry(accessToken, blockId);
    }, CLEAR_DELETE_CONCURRENCY);
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
      if (remaining.length) await sleep(APPEND_RATE_DELAY_MS);
    }
  }

  function buildPageProperties({ title, url, ai, includeDate, capturedAt }) {
    const props = {
      Name: { title: [{ type: "text", text: { content: title || "Untitled" } }] },
      URL: { url: url || "" }
    };
    if (includeDate) {
      const at = Number(capturedAt);
      const stamp = Number.isFinite(at) && at > 0 ? at : Date.now();
      props.Date = { date: { start: new Date(stamp).toISOString() } };
    }
    const aiName = aiLabelForSource(ai);
    if (aiName) props.AI = { multi_select: [{ name: aiName }] };
    return props;
  }

  function resolveProperties({ properties, title, url, ai, includeDate, capturedAt }) {
    if (properties && typeof properties === "object") return properties;
    return buildPageProperties({ title, url, ai, includeDate, capturedAt });
  }

  async function createPageInDatabase(accessToken, { databaseId, title, url, ai, properties, capturedAt }) {
    const body = {
      parent: { database_id: databaseId },
      properties: resolveProperties({ properties, title, url, ai, includeDate: true, capturedAt })
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/pages", body });
  }

  async function updatePageProperties(accessToken, { pageId, title, url, ai, properties }) {
    const body = {
      properties: resolveProperties({ properties, title, url, ai, includeDate: false })
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

  async function upgradeImageBlocksToFileUploads(accessToken, blocks) {
    const api = getImageUploadUpgraderApi();
    if (api && typeof api.upgradeImageBlocksToFileUploads === "function") {
      return api.upgradeImageBlocksToFileUploads(accessToken, blocks);
    }
    return Array.isArray(blocks) ? blocks : [];
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

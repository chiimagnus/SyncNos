(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const MAX_TEXT = 1900;
  const APPEND_BATCH = 90;
  const RATE_DELAY_MS = 250;

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

  function messagesToBlocks(messages) {
    const out = [];
    for (const m of messages || []) {
      const role = m.role || "assistant";
      const label = role === "user" ? "User" : role === "assistant" ? "Assistant" : role;
      out.push(headingBlock(label, role === "user" ? "green" : "blue_background"));
      const parts = splitText(m.contentText || "");
      for (const p of parts) out.push(textBlock(p));
    }
    return out;
  }

  async function listChildren(accessToken, blockId) {
    const res = await NS.notionApi.notionFetch({
      accessToken,
      method: "GET",
      path: `/v1/blocks/${blockId}/children?page_size=100`
    });
    return Array.isArray(res.results) ? res.results : [];
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

  async function createPageInDatabase(accessToken, { databaseId, title, url }) {
    const body = {
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ type: "text", text: { content: title || "Untitled" } }] },
        Date: { date: { start: new Date().toISOString() } },
        URL: { url: url || "" }
      }
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/pages", body });
  }

  async function updatePageProperties(accessToken, { pageId, title, url }) {
    const body = {
      properties: {
        Name: { title: [{ type: "text", text: { content: title || "Untitled" } }] },
        Date: { date: { start: new Date().toISOString() } },
        URL: { url: url || "" }
      }
    };
    return NS.notionApi.notionFetch({ accessToken, method: "PATCH", path: `/v1/pages/${pageId}`, body });
  }

  const api = {
    messagesToBlocks,
    clearPageChildren,
    appendChildren,
    createPageInDatabase,
    updatePageProperties
  };

  NS.notionSyncService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


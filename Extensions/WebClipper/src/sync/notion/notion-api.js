(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const NOTION_VERSION = "2022-06-28";
  const DEFAULT_PAGE_SIZE = 100;
  const MAX_SEARCH_REQUESTS = 100;

  async function notionFetch({ accessToken, method, path, body, notionVersion }) {
    if (!accessToken) throw new Error("missing notion access token");
    const url = `https://api.notion.com${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": notionVersion || NOTION_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`notion api failed: ${method} ${path} HTTP ${res.status} ${text}`);
    return text ? JSON.parse(text) : {};
  }

  function getPageTitle(page) {
    try {
      const props = page && page.properties ? page.properties : {};
      for (const key of Object.keys(props)) {
        const p = props[key];
        if (p && p.type === "title" && Array.isArray(p.title)) {
          const t = p.title.map((x) => x.plain_text || "").join("").trim();
          if (t) return t;
        }
      }
    } catch (_e) {
      // ignore
    }
    return page && page.url ? page.url : "Untitled";
  }

  function normalizePageSize(rawSize) {
    const size = Number(rawSize);
    if (!Number.isFinite(size) || size <= 0) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.min(100, Math.floor(size)));
  }

  async function searchPages({ accessToken, query, pageSize, startCursor }) {
    const body = {
      query: query || "",
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: normalizePageSize(pageSize)
    };
    if (startCursor) body.start_cursor = String(startCursor);
    return notionFetch({ accessToken, method: "POST", path: "/v1/search", body });
  }

  async function searchAllPages({ accessToken, query, pageSize, maxRequests }) {
    const requestLimit = (() => {
      const n = Number(maxRequests);
      if (!Number.isFinite(n) || n <= 0) return MAX_SEARCH_REQUESTS;
      return Math.max(1, Math.floor(n));
    })();
    const out = [];
    let cursor = "";

    for (let requestCount = 0; requestCount < requestLimit; requestCount += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await searchPages({ accessToken, query, pageSize, startCursor: cursor || undefined });
      const rows = Array.isArray(page && page.results) ? page.results : [];
      out.push(...rows);

      const hasMore = !!(page && page.has_more);
      const nextCursor = page && page.next_cursor ? String(page.next_cursor) : "";
      if (!hasMore || !nextCursor) {
        return { results: out, has_more: false, next_cursor: null };
      }
      cursor = nextCursor;
    }

    return { results: out, has_more: true, next_cursor: cursor || null };
  }

  const api = {
    notionFetch,
    searchPages,
    searchAllPages,
    getPageTitle,
    NOTION_VERSION
  };
  NS.notionApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

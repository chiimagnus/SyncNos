(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const NOTION_VERSION = "2022-06-28";

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

  async function searchPages({ accessToken, query, pageSize }) {
    const body = {
      query: query || "",
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: pageSize || 20
    };
    return notionFetch({ accessToken, method: "POST", path: "/v1/search", body });
  }

  const api = { notionFetch, searchPages, getPageTitle, NOTION_VERSION };
  NS.notionApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

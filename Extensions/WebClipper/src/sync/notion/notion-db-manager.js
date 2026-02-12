(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function dbTitleForSource(source) {
    if (source === "chatgpt") return "WebClipper - ChatGPT";
    if (source === "notionai") return "WebClipper - NotionAI";
    return `WebClipper - ${source}`;
  }

  async function getDatabase(accessToken, databaseId) {
    return NS.notionApi.notionFetch({ accessToken, method: "GET", path: `/v1/databases/${databaseId}` });
  }

  async function searchDatabases(accessToken, query) {
    const body = {
      query: query || "",
      filter: { property: "object", value: "database" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 20
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/search", body });
  }

  async function createDatabase(accessToken, { parentPageId, title }) {
    const body = {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} }
      }
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/databases", body });
  }

  async function ensureDatabaseForSource({ accessToken, parentPageId, source }) {
    const title = dbTitleForSource(source);
    const storageKey = `notion_db_id_${source}`;

    const cached = await new Promise((resolve) => {
      chrome.storage.local.get([storageKey], (res) => resolve((res && res[storageKey]) || ""));
    });
    if (cached) {
      try {
        const db = await getDatabase(accessToken, cached);
        return { source, databaseId: cached, title, reused: true, database: db };
      } catch (_e) {
        // Fall through: cached id invalid or no access.
      }
    }

    const found = await searchDatabases(accessToken, title);
    const results = Array.isArray(found.results) ? found.results : [];
    const exact = results.find((d) => {
      if (!d || d.object !== "database") return false;
      const t = Array.isArray(d.title) ? d.title.map((x) => x.plain_text || "").join("").trim() : "";
      return t === title;
    });
    if (exact && exact.id) {
      await new Promise((resolve) => chrome.storage.local.set({ [storageKey]: exact.id }, () => resolve(true)));
      return { source, databaseId: exact.id, title, reused: true, database: exact };
    }

    const created = await createDatabase(accessToken, { parentPageId, title });
    if (!created || !created.id) throw new Error("create database failed");
    await new Promise((resolve) => chrome.storage.local.set({ [storageKey]: created.id }, () => resolve(true)));
    return { source, databaseId: created.id, title, reused: false, database: created };
  }

  async function ensureDatabasesForSources({ accessToken, parentPageId, sources }) {
    if (!NS.notionApi || !NS.notionApi.notionFetch) throw new Error("notionApi missing");
    if (!accessToken) throw new Error("missing accessToken");
    if (!parentPageId) throw new Error("missing parentPageId");

    const srcs = Array.isArray(sources) && sources.length ? sources : ["chatgpt", "notionai"];
    const out = {};
    for (const s of srcs) {
      const item = await ensureDatabaseForSource({ accessToken, parentPageId, source: s });
      out[s] = item.databaseId;
    }
    return out;
  }

  const api = { ensureDatabasesForSources, ensureDatabaseForSource, dbTitleForSource };
  NS.notionDbManager = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DB_TITLE = "SyncNos-AI Chats";
  const DB_STORAGE_KEY = "notion_db_id_syncnos_ai_chats";

  function buildAiOptions() {
    const api = NS.notionAi;
    if (api && typeof api.buildAiOptions === "function") return api.buildAiOptions();
    return [];
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

  async function updateDatabase(accessToken, { databaseId, properties }) {
    const body = { properties: properties || {} };
    return NS.notionApi.notionFetch({ accessToken, method: "PATCH", path: `/v1/databases/${databaseId}`, body });
  }

  async function createDatabase(accessToken, { parentPageId, title }) {
    const body = {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        AI: { multi_select: { options: buildAiOptions() } }
      }
    };
    return NS.notionApi.notionFetch({ accessToken, method: "POST", path: "/v1/databases", body });
  }

  async function ensureDatabaseSchema({ accessToken, databaseId }) {
    const db = await getDatabase(accessToken, databaseId);
    const props = db && db.properties ? db.properties : {};
    const ai = props && props.AI ? props.AI : null;
    if (ai && ai.type === "multi_select") return true;

    // Best-effort: add the `AI` multi-select property if missing.
    try {
      await updateDatabase(accessToken, {
        databaseId,
        properties: {
          AI: { multi_select: { options: buildAiOptions() } }
        }
      });
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function ensureDatabase({ accessToken, parentPageId }) {
    const cached = await new Promise((resolve) => {
      chrome.storage.local.get([DB_STORAGE_KEY], (res) => resolve((res && res[DB_STORAGE_KEY]) || ""));
    });
    if (cached) {
      try {
        const db = await getDatabase(accessToken, cached);
        await ensureDatabaseSchema({ accessToken, databaseId: cached });
        return { databaseId: cached, title: DB_TITLE, reused: true, database: db };
      } catch (_e) {
        // Fall through: cached id invalid or no access.
      }
    }

    const found = await searchDatabases(accessToken, DB_TITLE);
    const results = Array.isArray(found.results) ? found.results : [];
    const exact = results.find((d) => {
      if (!d || d.object !== "database") return false;
      const t = Array.isArray(d.title) ? d.title.map((x) => x.plain_text || "").join("").trim() : "";
      return t === DB_TITLE;
    });
    if (exact && exact.id) {
      await new Promise((resolve) => chrome.storage.local.set({ [DB_STORAGE_KEY]: exact.id }, () => resolve(true)));
      await ensureDatabaseSchema({ accessToken, databaseId: exact.id });
      return { databaseId: exact.id, title: DB_TITLE, reused: true, database: exact };
    }

    const created = await createDatabase(accessToken, { parentPageId, title: DB_TITLE });
    if (!created || !created.id) throw new Error("create database failed");
    await new Promise((resolve) => chrome.storage.local.set({ [DB_STORAGE_KEY]: created.id }, () => resolve(true)));
    return { databaseId: created.id, title: DB_TITLE, reused: false, database: created };
  }

  const api = {
    ensureDatabase,
    ensureDatabaseSchema,
    buildAiOptions,
    DB_TITLE
  };
  NS.notionDbManager = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

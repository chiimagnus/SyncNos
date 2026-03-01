(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  let currentJob = null;

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function normalizeIds(list) {
    const ids = Array.isArray(list) ? list : [];
    return Array.from(new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  }

  function buildPerConversationResult({ conversationId, ok, mode, appended, error, at }) {
    return {
      conversationId,
      ok: !!ok,
      mode: safeString(mode) || (ok ? "ok" : "failed"),
      appended: Number.isFinite(Number(appended)) ? Number(appended) : 0,
      error: safeString(error),
      at: Number.isFinite(Number(at)) ? Number(at) : Date.now()
    };
  }

  async function testConnection({ instanceId } = {}) {
    const store = NS.obsidianSettingsStore;
    if (!store || typeof store.getConnectionConfig !== "function") throw new Error("obsidian settings store missing");

    const conn = await store.getConnectionConfig();
    if (!conn.enabled) return { ok: false, enabled: false, error: { code: "disabled", message: "Obsidian sync is disabled." }, instanceId: safeString(instanceId) };

    const clientMod = NS.obsidianLocalRestClient;
    if (!clientMod || typeof clientMod.createClient !== "function") throw new Error("obsidian local rest client missing");

    const client = clientMod.createClient(conn);
    if (!client || client.ok === false) {
      return { ok: false, enabled: true, error: client && client.error ? client.error : { code: "invalid_client", message: "invalid client" }, instanceId: safeString(instanceId) };
    }

    // Root endpoint allows reachability test and may report auth status.
    // @ts-ignore
    const res = await client.getServerStatus();
    if (!res || !res.ok) return { ok: false, enabled: true, error: res && res.error ? res.error : { code: "network_error", message: "connection failed" }, instanceId: safeString(instanceId) };

    return { ok: true, enabled: true, data: res.data || null, instanceId: safeString(instanceId) };
  }

  function getSyncStatus({ instanceId } = {}) {
    return { job: currentJob, instanceId: safeString(instanceId) };
  }

  async function syncConversations({ conversationIds, forceFullConversationIds, instanceId } = {}) {
    const ids = normalizeIds(conversationIds);
    const forceFullIds = new Set(normalizeIds(forceFullConversationIds));
    if (!ids.length) return { okCount: 0, failCount: 0, failures: [], results: [], instanceId: safeString(instanceId) };

    currentJob = {
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      conversationIds: ids,
      perConversation: []
    };

    const results = [];
    const failures = [];

    for (const conversationId of ids) {
      let row = null;
      try {
        // Task 6-8 will replace this placeholder implementation.
        row = buildPerConversationResult({
          conversationId,
          ok: false,
          mode: forceFullIds.has(conversationId) ? "force_full_requested" : "not_implemented",
          appended: 0,
          error: "Obsidian sync not implemented yet.",
          at: Date.now()
        });
      } catch (e) {
        row = buildPerConversationResult({
          conversationId,
          ok: false,
          mode: "failed",
          appended: 0,
          error: e && e.message ? e.message : String(e || "sync failed"),
          at: Date.now()
        });
      }
      results.push(row);
      currentJob.perConversation.push(row);
      if (!row.ok) failures.push({ conversationId, error: row.error || "unknown error" });
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    currentJob.status = "finished";
    currentJob.finishedAt = Date.now();

    return { okCount, failCount, failures, results, instanceId: safeString(instanceId) };
  }

  NS.obsidianSyncOrchestrator = {
    testConnection,
    getSyncStatus,
    syncConversations
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianSyncOrchestrator;
})();


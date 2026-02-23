(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function normalizeSyncRecord(input, now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const row = input && typeof input === "object" ? input : {};
    const conversationId = Number(row.conversationId);
    const ok = !!row.ok;
    const mode = row.mode ? String(row.mode) : (ok ? "ok" : "fail");
    const appended = Number(row.appended);
    const at = Number(row.at);
    return {
      conversationId: Number.isFinite(conversationId) && conversationId > 0 ? conversationId : 0,
      ok,
      mode,
      appended: Number.isFinite(appended) ? appended : 0,
      error: row.error ? String(row.error) : "",
      at: Number.isFinite(at) && at > 0 ? at : t
    };
  }

  function applySyncResults({ rows, state, onChanged } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    if (!state || typeof state !== "object") return { applied: 0 };
    if (!(state.notionSyncById instanceof Map)) state.notionSyncById = new Map();
    const map = state.notionSyncById;
    const now = Date.now();
    let applied = 0;

    for (const row of list) {
      const normalized = normalizeSyncRecord(row, now);
      if (!normalized.conversationId) continue;
      map.set(normalized.conversationId, {
        ok: normalized.ok,
        mode: normalized.mode,
        appended: normalized.appended,
        error: normalized.error,
        at: normalized.at
      });
      applied += 1;
    }

    if (applied > 0 && typeof onChanged === "function") onChanged();
    return { applied };
  }

  const api = {
    normalizeSyncRecord,
    applySyncResults
  };
  NS.popupNotionSyncState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

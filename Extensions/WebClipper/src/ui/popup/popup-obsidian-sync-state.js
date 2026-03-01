(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function normalizeSyncRecord(record, atFallback) {
    const r = record && typeof record === "object" ? record : {};
    const conversationId = Number(r.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return null;
    const ok = r.ok === true;
    const appended = Number(r.appended);
    const at = Number(r.at);
    return {
      conversationId,
      ok,
      mode: r.mode ? String(r.mode) : (ok ? "ok" : "fail"),
      appended: Number.isFinite(appended) ? appended : 0,
      error: r.error ? String(r.error) : "",
      at: Number.isFinite(at) ? at : (Number.isFinite(atFallback) ? atFallback : Date.now())
    };
  }

  function applySyncResults({ rows, state, onChanged } = {}) {
    if (!state || !(state.obsidianSyncById instanceof Map)) return { applied: 0 };
    const list = Array.isArray(rows) ? rows : [];
    const now = Date.now();
    let applied = 0;
    for (const r of list) {
      const normalized = normalizeSyncRecord(r, now);
      if (!normalized) continue;
      state.obsidianSyncById.set(normalized.conversationId, normalized);
      applied += 1;
    }
    if (applied && typeof onChanged === "function") {
      try {
        onChanged();
      } catch (_e) {
        // ignore
      }
    }
    return { applied };
  }

  NS.popupObsidianSyncState = {
    normalizeSyncRecord,
    applySyncResults
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupObsidianSyncState;
})();


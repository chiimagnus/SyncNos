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

  function buildSyncSummary(results, instanceId) {
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const failures = results.filter((r) => !r.ok).map((r) => ({ conversationId: r.conversationId, error: r.error || "unknown error" }));
    return { okCount, failCount, failures, results, instanceId: safeString(instanceId) };
  }

  function pickLocalCursor(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return { lastSyncedSequence: null, lastSyncedMessageKey: "" };
    const last = list[list.length - 1] || {};
    return {
      lastSyncedSequence: Number.isFinite(Number(last.sequence)) ? Number(last.sequence) : null,
      lastSyncedMessageKey: safeString(last.messageKey),
      lastSyncedMessageUpdatedAt: Number.isFinite(Number(last.updatedAt)) ? Number(last.updatedAt) : null,
      lastSyncedAt: Date.now()
    };
  }

  function computeDelta(messages, cursor) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return { ok: true, newMessages: [], reason: "empty" };

    const seq = cursor && cursor.lastSyncedSequence != null && Number.isFinite(Number(cursor.lastSyncedSequence))
      ? Number(cursor.lastSyncedSequence)
      : null;
    const key = cursor && cursor.lastSyncedMessageKey ? safeString(cursor.lastSyncedMessageKey) : "";
    if (seq == null || !key) return { ok: false, reason: "missing_cursor" };

    const anchor = list.find((m) => safeString(m && m.messageKey) === key && Number(m && m.sequence) === seq);
    if (!anchor) return { ok: false, reason: "cursor_mismatch" };

    const expectedUpdatedAt = cursor && cursor.lastSyncedMessageUpdatedAt != null && Number.isFinite(Number(cursor.lastSyncedMessageUpdatedAt))
      ? Number(cursor.lastSyncedMessageUpdatedAt)
      : null;
    const actualUpdatedAt = anchor && Number.isFinite(Number(anchor.updatedAt)) ? Number(anchor.updatedAt) : null;
    if (expectedUpdatedAt != null && actualUpdatedAt != null && expectedUpdatedAt !== actualUpdatedAt) {
      return { ok: false, reason: "cursor_updatedAt_mismatch" };
    }

    const newMessages = list.filter((m) => Number(m && m.sequence) > seq);
    return { ok: true, newMessages, reason: newMessages.length ? "has_changes" : "no_changes" };
  }

  async function buildClient() {
    const store = NS.obsidianSettingsStore;
    if (!store || typeof store.getConnectionConfig !== "function") throw new Error("obsidian settings store missing");
    const conn = await store.getConnectionConfig();
    if (!conn.enabled) return { ok: false, error: { code: "disabled", message: "Obsidian sync is disabled." } };

    const clientMod = NS.obsidianLocalRestClient;
    if (!clientMod || typeof clientMod.createClient !== "function") throw new Error("obsidian local rest client missing");
    const client = clientMod.createClient(conn);
    if (!client || client.ok === false) return { ok: false, error: client && client.error ? client.error : { code: "invalid_client", message: "invalid client" } };
    return { ok: true, client };
  }

  async function decideSyncModeForConversation({ conversationId, forceFull } = {}) {
    const storage = NS.backgroundStorage;
    if (!storage || typeof storage.getConversationById !== "function" || typeof storage.getMessagesByConversationId !== "function") {
      throw new Error("storage module missing");
    }

    const convo = await storage.getConversationById(conversationId);
    if (!convo) {
      return { isFinal: true, row: buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: "conversation not found", at: Date.now() }) };
    }

    const messages = await storage.getMessagesByConversationId(conversationId);
    if (!Array.isArray(messages) || !messages.length) {
      return { isFinal: true, row: buildPerConversationResult({ conversationId, ok: false, mode: "empty", appended: 0, error: "No messages to sync.", at: Date.now() }) };
    }

    const notePathMod = NS.obsidianNotePath;
    if (!notePathMod || typeof notePathMod.buildStableNotePath !== "function") throw new Error("obsidian note path module missing");
    const filePath = notePathMod.buildStableNotePath(convo);

    const clientRes = await buildClient();
    if (!clientRes.ok) {
      return { isFinal: true, row: buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: clientRes.error && clientRes.error.message ? clientRes.error.message : "client error", at: Date.now() }) };
    }
    const client = clientRes.client;

    if (forceFull) {
      return { isFinal: false, conversationId, convo, filePath, messages, mode: "full_rebuild_forced" };
    }

    // @ts-ignore
    const remote = await client.getVaultFile(filePath, { accept: client.NOTE_JSON_ACCEPT || "application/vnd.olrapi.note+json" });
    if (!remote.ok) {
      if (remote.status === 404) {
        return { isFinal: false, conversationId, convo, filePath, messages, mode: "full_rebuild" };
      }
      return { isFinal: true, row: buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: remote.error && remote.error.message ? remote.error.message : "remote error", at: Date.now() }) };
    }

    const note = remote.data && typeof remote.data === "object" ? remote.data : null;
    const frontmatter = note && note.frontmatter && typeof note.frontmatter === "object" ? note.frontmatter : null;

    const metaMod = NS.obsidianSyncMetadata;
    if (!metaMod || typeof metaMod.readSyncnosObject !== "function") throw new Error("obsidian sync metadata module missing");
    const parsed = metaMod.readSyncnosObject(frontmatter);
    if (!parsed.ok) {
      return { isFinal: false, conversationId, convo, filePath, messages, mode: "full_rebuild" };
    }
    if (parsed.data.source !== safeString(convo.source) || parsed.data.conversationKey !== safeString(convo.conversationKey)) {
      return { isFinal: false, conversationId, convo, filePath, messages, mode: "full_rebuild" };
    }

    const delta = computeDelta(messages, parsed.data);
    if (!delta.ok) {
      return { isFinal: false, conversationId, convo, filePath, messages, mode: "full_rebuild" };
    }
    if (!delta.newMessages.length) {
      return { isFinal: true, row: buildPerConversationResult({ conversationId, ok: true, mode: "no_changes", appended: 0, error: "", at: Date.now() }) };
    }

    const nextCursor = pickLocalCursor(messages);
    return {
      isFinal: false,
      conversationId,
      convo,
      filePath,
      messages,
      mode: "incremental_append",
      newMessages: delta.newMessages,
      nextCursor
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

    for (const conversationId of ids) {
      let row = null;
      try {
        const decision = await decideSyncModeForConversation({ conversationId, forceFull: forceFullIds.has(conversationId) });
        if (decision && decision.isFinal) {
          row = decision.row;
        } else if (decision && decision.mode && decision.conversationId) {
          const writer = NS.obsidianMarkdownWriter;
          const metaMod = NS.obsidianSyncMetadata;
          const clientRes = await buildClient();
          const client = clientRes.ok ? clientRes.client : null;

          if (!clientRes.ok || !client) {
            row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: clientRes.error && clientRes.error.message ? clientRes.error.message : "client error", at: Date.now() });
          } else if (decision.mode === "full_rebuild" || decision.mode === "full_rebuild_forced") {
            if (!writer || typeof writer.buildFullNoteMarkdown !== "function") throw new Error("obsidian markdown writer missing");
            if (!metaMod || typeof metaMod.buildSyncnosObject !== "function") throw new Error("obsidian sync metadata module missing");
            const syncnosObject = metaMod.buildSyncnosObject({ conversation: decision.convo, cursor: pickLocalCursor(decision.messages) });
            const markdown = writer.buildFullNoteMarkdown({ conversation: decision.convo, messages: decision.messages, syncnosObject });
            // @ts-ignore
            const putRes = await client.putVaultFile(decision.filePath, markdown);
            if (!putRes || !putRes.ok) {
              row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: putRes && putRes.error && putRes.error.message ? putRes.error.message : "put failed", at: Date.now() });
            } else {
              row = buildPerConversationResult({ conversationId, ok: true, mode: decision.mode, appended: decision.messages.length, error: "", at: Date.now() });
            }
          } else if (decision.mode === "incremental_append") {
            if (!writer || typeof writer.buildIncrementalAppendMarkdown !== "function") throw new Error("obsidian markdown writer missing");
            if (!metaMod || typeof metaMod.buildSyncnosObject !== "function") throw new Error("obsidian sync metadata module missing");
            const chunk = writer.buildIncrementalAppendMarkdown({ newMessages: decision.newMessages });
            // @ts-ignore
            const patchRes = await writer.appendUnderMessagesHeading({ client, filePath: decision.filePath, markdown: chunk });
            const isIdempotentDup = !patchRes.ok
              && patchRes.error
              && patchRes.error.code === "bad_request"
              && patchRes.error.body
              && typeof patchRes.error.body === "object"
              && String(patchRes.error.body.message || "").includes("content-already-preexists-in-target");
            const patchFailedCode = patchRes && patchRes.error && patchRes.error.body && typeof patchRes.error.body === "object"
              ? Number(patchRes.error.body.errorCode)
              : null;
            const isPatchFailed = !patchRes.ok && (patchFailedCode === 40080 || String(patchRes.error && patchRes.error.body && patchRes.error.body.message || "").includes("PatchFailed"));

            if (!patchRes.ok && !isIdempotentDup && !isPatchFailed) {
              row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: patchRes.error && patchRes.error.message ? patchRes.error.message : "patch failed", at: Date.now() });
            } else if (!patchRes.ok && isPatchFailed && !isIdempotentDup) {
              // Fallback to full rebuild.
              const syncnosObject = metaMod.buildSyncnosObject({ conversation: decision.convo, cursor: pickLocalCursor(decision.messages) });
              const markdown = writer.buildFullNoteMarkdown({ conversation: decision.convo, messages: decision.messages, syncnosObject });
              // @ts-ignore
              const putRes = await client.putVaultFile(decision.filePath, markdown);
              if (!putRes || !putRes.ok) {
                row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: putRes && putRes.error && putRes.error.message ? putRes.error.message : "put failed", at: Date.now() });
              } else {
                row = buildPerConversationResult({ conversationId, ok: true, mode: "full_rebuild_fallback", appended: decision.messages.length, error: "", at: Date.now() });
              }
            } else {
              const syncnosObject = metaMod.buildSyncnosObject({ conversation: decision.convo, cursor: decision.nextCursor });
              // @ts-ignore
              const fmRes = await writer.replaceSyncnosFrontmatter({ client, filePath: decision.filePath, syncnosObject });
              if (!fmRes || !fmRes.ok) {
                row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: fmRes && fmRes.error && fmRes.error.message ? fmRes.error.message : "frontmatter patch failed", at: Date.now() });
              } else {
                row = buildPerConversationResult({ conversationId, ok: true, mode: "incremental_append", appended: decision.newMessages.length, error: "", at: Date.now() });
              }
            }
          } else {
            row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: "unknown mode", at: Date.now() });
          }
        } else if (decision && decision.row) {
          row = decision.row;
        } else {
          row = buildPerConversationResult({ conversationId, ok: false, mode: "failed", appended: 0, error: "invalid decision", at: Date.now() });
        }
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
    }

    currentJob.status = "finished";
    currentJob.finishedAt = Date.now();

    return buildSyncSummary(results, instanceId);
  }

  NS.obsidianSyncOrchestrator = {
    testConnection,
    getSyncStatus,
    syncConversations
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianSyncOrchestrator;
})();

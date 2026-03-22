const SCHEMA_VERSION = 1;

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function safeNumberOrNull(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function readSyncnosObject(frontmatter: unknown) {
  const fm = frontmatter && typeof frontmatter === 'object' ? (frontmatter as any) : null;
  const obj = fm && fm.syncnos && typeof fm.syncnos === 'object' ? fm.syncnos : null;
  if (!obj) return { ok: false, reason: 'missing' };

  const schemaVersion = Number(obj.schemaVersion);
  if (!Number.isFinite(schemaVersion) || schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'schema_mismatch',
      schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
    };
  }

  const source = safeString(obj.source);
  const conversationKey = safeString(obj.conversationKey);
  if (!source || !conversationKey) return { ok: false, reason: 'invalid' };

  return {
    ok: true,
    data: {
      source,
      conversationKey,
      schemaVersion,
      lastSyncedAt: safeNumberOrNull(obj.lastSyncedAt),
    },
  };
}

function buildSyncnosObject({
  conversation,
  lastSyncedAt,
}: {
  conversation?: any;
  lastSyncedAt?: unknown;
} = {}) {
  const c = conversation || {};
  const source = safeString(c.source);
  const conversationKey = safeString(c.conversationKey);
  if (!source || !conversationKey) throw new Error('missing source or conversationKey');

  return {
    source,
    conversationKey,
    schemaVersion: SCHEMA_VERSION,
    lastSyncedAt: safeNumberOrNull(lastSyncedAt),
  };
}

const api = {
  SCHEMA_VERSION,
  readSyncnosObject,
  buildSyncnosObject,
};

export { SCHEMA_VERSION, readSyncnosObject, buildSyncnosObject };
export default api;

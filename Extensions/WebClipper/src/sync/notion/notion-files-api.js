(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const FILE_UPLOAD_VERSION = "2025-09-03";
  const DEFAULT_POLL_INTERVAL_MS = 800;
  const DEFAULT_MAX_ATTEMPTS = 20;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isHttpUrl(url) {
    const text = String(url || "").trim();
    return /^https?:\/\//i.test(text);
  }

  function sanitizeFilename(name) {
    const cleaned = String(name || "")
      .replaceAll("\"", "")
      .replaceAll("\n", "")
      .replaceAll("\r", "")
      .trim();
    return cleaned || "image.jpg";
  }

  function guessFilenameFromUrl(url) {
    try {
      const u = new URL(String(url || ""));
      const last = String(u.pathname || "").split("/").filter(Boolean).pop() || "";
      const safe = sanitizeFilename(last);
      if (safe.includes(".")) return safe;
      return "image.jpg";
    } catch (_e) {
      return "image.jpg";
    }
  }

  function describeFileImportResult(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === "object") {
      try {
        const keys = Object.keys(value);
        if (keys.length <= 6) return `{${keys.join(",")}}`;
      } catch (_e) {
        // ignore
      }
      try {
        const s = JSON.stringify(value);
        return s && s.length > 220 ? `${s.slice(0, 220)}…` : (s || "");
      } catch (_e) {
        return "{object}";
      }
    }
    return String(value);
  }

  async function createExternalURLUpload({ accessToken, url, filename, contentType }) {
    if (!NS.notionApi || typeof NS.notionApi.notionFetch !== "function") throw new Error("notion api missing");
    const target = String(url || "").trim();
    if (!isHttpUrl(target)) throw new Error("invalid external image url");
    const body = {
      mode: "external_url",
      external_url: target,
      filename: sanitizeFilename(filename || guessFilenameFromUrl(target))
    };
    const ct = String(contentType || "").trim();
    if (ct) body.content_type = ct;
    return NS.notionApi.notionFetch({
      accessToken,
      method: "POST",
      path: "/v1/file_uploads",
      body,
      notionVersion: FILE_UPLOAD_VERSION
    });
  }

  async function createFileUpload({ accessToken, filename, contentType, contentLength }) {
    if (!NS.notionApi || typeof NS.notionApi.notionFetch !== "function") throw new Error("notion api missing");
    const name = sanitizeFilename(filename || "");
    const ct = String(contentType || "").trim() || "application/octet-stream";
    const len = Number(contentLength);
    if (!Number.isFinite(len) || len <= 0) throw new Error("invalid contentLength");
    const body = {
      mode: "file",
      filename: name,
      content_type: ct,
      content_length: len
    };
    return NS.notionApi.notionFetch({
      accessToken,
      method: "POST",
      path: "/v1/file_uploads",
      body,
      notionVersion: FILE_UPLOAD_VERSION
    });
  }

  async function uploadBytesToUploadUrl({ uploadUrl, bytes, contentType }) {
    const target = String(uploadUrl || "").trim();
    if (!isHttpUrl(target)) throw new Error("invalid uploadUrl");
    const ct = String(contentType || "").trim() || "application/octet-stream";
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error("invalid bytes");
    const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const res = await fetch(target, {
      method: "PUT",
      headers: { "Content-Type": ct },
      body
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`upload_url PUT failed HTTP ${res.status} ${text || ""}`.trim());
    }
    return { ok: true };
  }

  async function completeUpload({ accessToken, id }) {
    if (!NS.notionApi || typeof NS.notionApi.notionFetch !== "function") throw new Error("notion api missing");
    const uploadId = String(id || "").trim();
    if (!uploadId) throw new Error("missing upload id");
    return NS.notionApi.notionFetch({
      accessToken,
      method: "POST",
      path: `/v1/file_uploads/${encodeURIComponent(uploadId)}/complete`,
      body: {},
      notionVersion: FILE_UPLOAD_VERSION
    });
  }

  async function retrieveUpload({ accessToken, id }) {
    if (!NS.notionApi || typeof NS.notionApi.notionFetch !== "function") throw new Error("notion api missing");
    const uploadId = String(id || "").trim();
    if (!uploadId) throw new Error("missing upload id");
    return NS.notionApi.notionFetch({
      accessToken,
      method: "GET",
      path: `/v1/file_uploads/${encodeURIComponent(uploadId)}`,
      body: null,
      notionVersion: FILE_UPLOAD_VERSION
    });
  }

  async function waitUntilUploaded({ accessToken, id, pollIntervalMs, maxAttempts } = {}) {
    const uploadId = String(id || "").trim();
    if (!uploadId) throw new Error("missing upload id");
    const interval = Number.isFinite(Number(pollIntervalMs)) ? Math.max(50, Number(pollIntervalMs)) : DEFAULT_POLL_INTERVAL_MS;
    const attempts = Number.isFinite(Number(maxAttempts)) ? Math.max(1, Number(maxAttempts)) : DEFAULT_MAX_ATTEMPTS;

    for (let i = 1; i <= attempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const upload = await retrieveUpload({ accessToken, id: uploadId });
      const status = upload && upload.status ? String(upload.status) : "";
      if (status === "uploaded") return upload;
      if (status === "failed") {
        const extra = describeFileImportResult(upload && upload.file_import_result);
        throw new Error(extra ? `file upload failed: ${extra}` : "file upload failed");
      }
      if (status === "expired") throw new Error("file upload expired");
      if (status !== "pending") throw new Error(`file upload unknown status: ${status || "unknown"}`);
      if (i < attempts) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(interval);
      }
    }
    throw new Error("file upload timed out");
  }

  const api = {
    FILE_UPLOAD_VERSION,
    createExternalURLUpload,
    createFileUpload,
    uploadBytesToUploadUrl,
    completeUpload,
    retrieveUpload,
    waitUntilUploaded
  };

  NS.notionFilesApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

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
      if (status === "failed") throw new Error("file upload failed");
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
    retrieveUpload,
    waitUntilUploaded
  };

  NS.notionFilesApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();


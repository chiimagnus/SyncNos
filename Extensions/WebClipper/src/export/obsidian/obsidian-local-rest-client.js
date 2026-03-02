/* global fetch */

(function () {
  const NS = require("../../runtime-context.js");

  const NOTE_JSON_ACCEPT = "application/vnd.olrapi.note+json";

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function stripTrailingSlashes(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function isHttpUrl(url) {
    return /^http:\/\//i.test(String(url || "").trim());
  }

  function isHttpsUrl(url) {
    return /^https:\/\//i.test(String(url || "").trim());
  }

  function encodeVaultPath(path) {
    const raw = safeString(path);
    // Allow nested folders; encode each segment so "/" remains a separator.
    return raw
      .split("/")
      .filter((seg) => seg !== "")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  function classifyError(status) {
    if (status === 401 || status === 403) return "auth_error";
    if (status === 404) return "not_found";
    if (status === 400) return "bad_request";
    if (!Number.isFinite(status) || status <= 0) return "network_error";
    return "http_error";
  }

  async function readBodyAsText(res) {
    try {
      return await res.text();
    } catch (_e) {
      return "";
    }
  }

  async function readBodyAsJsonOrText(res) {
    const ct = String(res.headers && res.headers.get ? (res.headers.get("content-type") || "") : "").toLowerCase();
    if (ct.includes("application/json") || ct.includes("+json")) {
      try {
        return await res.json();
      } catch (_e) {
        // fall through
      }
    }
    const text = await readBodyAsText(res);
    // Try parse JSON anyway; some servers omit content-type.
    try {
      return JSON.parse(text);
    } catch (_e) {
      return text;
    }
  }

  function toErrorObject({ status, body, fallbackMessage }) {
    const errorCode = body && typeof body === "object" && Number.isFinite(body.errorCode) ? Number(body.errorCode) : null;
    const message = body && typeof body === "object" && body.message ? String(body.message) : String(fallbackMessage || "request failed");
    return {
      code: classifyError(status),
      status,
      errorCode,
      message,
      body
    };
  }

  function createClient({ apiBaseUrl, apiKey, authHeaderName } = {}) {
    const baseUrl = stripTrailingSlashes(safeString(apiBaseUrl));
    if (isHttpsUrl(baseUrl)) {
      return {
        ok: false,
        error: { code: "https_unsupported", status: 0, errorCode: null, message: "HTTPS is not supported in this version. Use http://127.0.0.1:27123.", body: null }
      };
    }
    if (!isHttpUrl(baseUrl)) {
      return {
        ok: false,
        error: { code: "invalid_base_url", status: 0, errorCode: null, message: "Invalid API Base URL. Expected http://127.0.0.1:27123.", body: null }
      };
    }

    const headerName = safeString(authHeaderName) || "Authorization";
    const key = safeString(apiKey);

    function buildUrl(route) {
      const r = String(route || "");
      if (!r.startsWith("/")) return `${baseUrl}/${r}`;
      return `${baseUrl}${r}`;
    }

    async function request(method, route, { headers, body, accept, contentType } = {}) {
      if (typeof fetch !== "function") {
        return { ok: false, status: 0, data: null, error: { code: "network_error", status: 0, errorCode: null, message: "fetch unavailable", body: null } };
      }
      const h = new Headers(headers || {});
      if (accept) h.set("Accept", String(accept));
      if (contentType) h.set("Content-Type", String(contentType));
      if (key) h.set(headerName, `Bearer ${key}`);

      let res = null;
      try {
        res = await fetch(buildUrl(route), {
          method,
          headers: h,
          body
        });
      } catch (e) {
        return { ok: false, status: 0, data: null, error: { code: "network_error", status: 0, errorCode: null, message: e && e.message ? e.message : "network error", body: null } };
      }

      const status = Number(res.status);
      if (res.ok) {
        if (status === 204) return { ok: true, status, data: null, error: null };
        const data = await readBodyAsJsonOrText(res);
        return { ok: true, status, data, error: null };
      }

      const bodyObj = await readBodyAsJsonOrText(res);
      return { ok: false, status, data: null, error: toErrorObject({ status, body: bodyObj, fallbackMessage: "request failed" }) };
    }

    function getVaultFile(filePath, { accept } = {}) {
      const encoded = encodeVaultPath(filePath);
      return request("GET", `/vault/${encoded}`, { accept: accept || "text/markdown" });
    }

    function putVaultFile(filePath, markdown) {
      const encoded = encodeVaultPath(filePath);
      return request("PUT", `/vault/${encoded}`, { body: String(markdown || ""), contentType: "text/markdown", accept: "application/json" });
    }

    function patchVaultFile(filePath, { operation, targetType, target, delimiter, trimTargetWhitespace, createTargetIfMissing, body, contentType } = {}) {
      const encoded = encodeVaultPath(filePath);
      const headers = {};
      if (operation) headers["Operation"] = String(operation);
      if (targetType) headers["Target-Type"] = String(targetType);
      if (target != null) headers["Target"] = String(target);
      if (delimiter) headers["Target-Delimiter"] = String(delimiter);
      if (trimTargetWhitespace != null) headers["Trim-Target-Whitespace"] = trimTargetWhitespace ? "true" : "false";
      if (createTargetIfMissing != null) headers["Create-Target-If-Missing"] = createTargetIfMissing ? "true" : "false";
      return request("PATCH", `/vault/${encoded}`, { headers, body, contentType: contentType || "text/markdown", accept: "application/json" });
    }

    function getServerStatus() {
      // This is the only endpoint that does not require auth.
      return request("GET", `/`, { accept: "application/json" });
    }

    return {
      ok: true,
      error: null,
      NOTE_JSON_ACCEPT,
      getServerStatus,
      getVaultFile,
      putVaultFile,
      patchVaultFile
    };
  }

  NS.obsidianLocalRestClient = {
    NOTE_JSON_ACCEPT,
    encodeVaultPath,
    createClient
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.obsidianLocalRestClient;
})();

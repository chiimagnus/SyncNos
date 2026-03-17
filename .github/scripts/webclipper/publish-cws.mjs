import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRepoRoot, resolveWebclipperRoot } from "./script-utils.mjs";

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`missing env: ${name}`);
  return String(v).trim();
}

function parseBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePublishTarget(raw) {
  const v = String(raw || "default").trim();
  if (v === "default" || v === "trustedTesters") return v;
  throw new Error(`invalid CWS_PUBLISH_TARGET: ${v} (expected default|trustedTesters)`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function requestJson({ method, url, headers, body }) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = json ? JSON.stringify(json, null, 2) : text;
    throw new Error(`[cws] ${method} ${url} failed (${res.status}):\n${msg}`);
  }

  return { res, text, json };
}

async function fetchAccessToken({ clientId, clientSecret, refreshToken }) {
  const url = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const { json } = await requestJson({
    method: "POST",
    url,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const token = json && json.access_token ? String(json.access_token).trim() : "";
  if (!token) throw new Error(`[cws] token endpoint returned empty access_token`);
  return token;
}

async function cwsRequest({ method, url, accessToken, headers, body }) {
  return await requestJson({
    method,
    url,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2",
      ...(headers || {})
    },
    body
  });
}

async function uploadZip({ extensionId, accessToken, zipPath }) {
  const url = `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}?uploadType=media`;
  const buf = readFileSync(zipPath);
  const { json } = await cwsRequest({
    method: "PUT",
    url,
    accessToken,
    headers: { "Content-Type": "application/zip" },
    body: buf
  });

  const uploadState = json && json.uploadState ? String(json.uploadState) : "";
  // eslint-disable-next-line no-console
  console.log(`[cws] uploadState: ${uploadState || "unknown"}`);

  if (uploadState === "SUCCESS") return;
  if (uploadState === "FAILURE") {
    throw new Error(`[cws] upload failed:\n${JSON.stringify(json, null, 2)}`);
  }
}

async function tryPublishItem({ extensionId, accessToken, target }) {
  const url = `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${encodeURIComponent(target)}`;
  const { json } = await cwsRequest({
    method: "POST",
    url,
    accessToken,
    headers: { "Content-Length": "0" }
  });

  const status = Array.isArray(json && json.status) ? json.status.map(String) : [];
  return { ok: status.includes("OK"), status, json };
}

async function publishWithRetry({ extensionId, accessToken, target, maxRetries, retryAfterMs }) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const { ok, status, json } = await tryPublishItem({ extensionId, accessToken, target });
      // eslint-disable-next-line no-console
      console.log(`[cws] publish status: ${status.length ? status.join(", ") : "unknown"} (attempt ${i}/${maxRetries})`);
      if (ok) return;
      // eslint-disable-next-line no-console
      console.log(`[cws] publish not OK, response:\n${JSON.stringify(json, null, 2)}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`[cws] publish request failed (attempt ${i}/${maxRetries}): ${e && e.message ? e.message : String(e)}`);
    }

    await sleep(retryAfterMs);
  }

  throw new Error(`[cws] publish did not succeed in time (retries=${maxRetries}, retryAfterMs=${retryAfterMs})`);
}

async function main() {
  const extensionId = requiredEnv("CWS_EXTENSION_ID");
  const clientId = requiredEnv("CWS_CLIENT_ID");
  const clientSecret = requiredEnv("CWS_CLIENT_SECRET");
  const refreshToken = requiredEnv("CWS_REFRESH_TOKEN");

  const publish = parseBoolEnv("CWS_PUBLISH", true);
  const target = normalizePublishTarget(process.env.CWS_PUBLISH_TARGET);
  const maxRetries = parseIntEnv("CWS_RETRY_LIMIT", 60);
  const retryAfterMs = parseIntEnv("CWS_RETRY_AFTER_MS", 5000);

  const repoRoot = resolveRepoRoot(import.meta.url);
  const webclipperRoot = resolveWebclipperRoot(repoRoot);
  const zipPath =
    process.env.CWS_ZIP_PATH ||
    join(webclipperRoot, "SyncNos-WebClipper-chrome.zip");

  // eslint-disable-next-line no-console
  console.log(`[cws] extension id: ${extensionId}`);
  // eslint-disable-next-line no-console
  console.log(`[cws] zip: ${zipPath}`);
  // eslint-disable-next-line no-console
  console.log(`[cws] publish: ${publish} (target=${target})`);

  const accessToken = await fetchAccessToken({ clientId, clientSecret, refreshToken });
  await uploadZip({ extensionId, accessToken, zipPath });

  if (!publish) return;
  await publishWithRetry({ extensionId, accessToken, target, maxRetries, retryAfterMs });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});

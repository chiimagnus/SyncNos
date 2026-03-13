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

function normalizeBaseUrl(raw) {
  const base = (raw || "https://api.addons.microsoftedge.microsoft.com").replace(/\/+$/g, "");
  // Microsoft Learn docs consistently show /v1 paths even for "v1.1" auth mode.
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function parseOperationId(location) {
  const v = String(location || "").trim();
  if (!v) return "";
  if (v.includes("/")) return v.split("/").filter(Boolean).at(-1) || "";
  return v;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function edgeRequest({ method, url, clientId, apiKey, headers, body }) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      "X-ClientID": clientId,
      ...(headers || {})
    },
    body
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = json ? JSON.stringify(json, null, 2) : text;
    throw new Error(`[edge] ${method} ${url} failed (${res.status}):\n${msg}`);
  }

  return { res, text, json };
}

async function uploadPackage({ baseUrl, productId, clientId, apiKey, zipPath }) {
  const buf = readFileSync(zipPath);
  const url = `${baseUrl}/products/${productId}/submissions/draft/package`;
  const { res } = await edgeRequest({
    method: "POST",
    url,
    clientId,
    apiKey,
    headers: { "Content-Type": "application/zip" },
    body: buf
  });

  const operationId = parseOperationId(res.headers.get("location"));
  if (!operationId) throw new Error(`[edge] missing operation id (Location header) for package upload`);
  return operationId;
}

async function publishDraft({ baseUrl, productId, clientId, apiKey, notes }) {
  const url = `${baseUrl}/products/${productId}/submissions`;
  const { res } = await edgeRequest({
    method: "POST",
    url,
    clientId,
    apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: String(notes || "") })
  });

  const operationId = parseOperationId(res.headers.get("location"));
  if (!operationId) throw new Error(`[edge] missing operation id (Location header) for publish`);
  return operationId;
}

async function waitOperation({ name, url, clientId, apiKey, maxRetries, retryAfterMs }) {
  for (let i = 1; i <= maxRetries; i++) {
    const { json } = await edgeRequest({ method: "GET", url, clientId, apiKey });
    const status = json && json.status ? String(json.status) : "";

    // eslint-disable-next-line no-console
    console.log(`[edge] ${name} status: ${status || "unknown"} (attempt ${i}/${maxRetries})`);

    if (status === "Succeeded") return json;
    if (status === "Failed") {
      throw new Error(`[edge] ${name} failed:\n${JSON.stringify(json, null, 2)}`);
    }

    await sleep(retryAfterMs);
  }

  throw new Error(`[edge] ${name} did not finish in time (retries=${maxRetries}, retryAfterMs=${retryAfterMs})`);
}

async function main() {
  const clientId = requiredEnv("EDGE_ADDONS_CLIENT_ID");
  const apiKey = requiredEnv("EDGE_ADDONS_API_KEY");
  const productId = requiredEnv("EDGE_ADDONS_PRODUCT_ID");

  const baseUrl = normalizeBaseUrl(process.env.EDGE_ADDONS_BASE_URL);
  const publish = parseBoolEnv("EDGE_ADDONS_PUBLISH", true);
  const maxRetries = parseIntEnv("EDGE_ADDONS_RETRY_LIMIT", 120);
  const retryAfterMs = parseIntEnv("EDGE_ADDONS_RETRY_AFTER_MS", 5000);

  const repoRoot = resolveRepoRoot(import.meta.url);
  const webclipperRoot = resolveWebclipperRoot(repoRoot);
  const zipPath = process.env.EDGE_ZIP_PATH || join(webclipperRoot, "SyncNos-WebClipper-edge.zip");

  const sha = String(process.env.GITHUB_SHA || "").trim();
  const tag = String(process.env.GITHUB_REF_NAME || "").trim();
  const notes = process.env.EDGE_ADDONS_PUBLISH_NOTES || `SyncNos WebClipper ${tag || "(no tag)"} (${sha ? sha.slice(0, 7) : "no-sha"})`;

  // eslint-disable-next-line no-console
  console.log(`[edge] api base: ${baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`[edge] product id: ${productId}`);
  // eslint-disable-next-line no-console
  console.log(`[edge] zip: ${zipPath}`);
  // eslint-disable-next-line no-console
  console.log(`[edge] publish: ${publish}`);

  const uploadOp = await uploadPackage({ baseUrl, productId, clientId, apiKey, zipPath });
  // eslint-disable-next-line no-console
  console.log(`[edge] upload operation id: ${uploadOp}`);

  await waitOperation({
    name: "upload",
    url: `${baseUrl}/products/${productId}/submissions/draft/package/operations/${uploadOp}`,
    clientId,
    apiKey,
    maxRetries,
    retryAfterMs
  });

  if (!publish) return;

  const publishOp = await publishDraft({ baseUrl, productId, clientId, apiKey, notes });
  // eslint-disable-next-line no-console
  console.log(`[edge] publish operation id: ${publishOp}`);

  await waitOperation({
    name: "publish",
    url: `${baseUrl}/products/${productId}/submissions/operations/${publishOp}`,
    clientId,
    apiKey,
    maxRetries,
    retryAfterMs
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});


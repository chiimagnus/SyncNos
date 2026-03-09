import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveRepoRoot, resolveWebclipperRoot } from "./script-utils.mjs";

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`missing env: ${name}`);
  return String(v).trim();
}

function base64Url(input) {
  const b64 = Buffer.from(input).toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwtHs256({ issuer, secret }) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(JSON.stringify({
    iss: issuer,
    jti: randomUUID(),
    iat: now,
    exp: now + 60
  }));
  const msg = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(msg).digest("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${msg}.${sig}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function amoRequest({ method, url, token, body }) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `JWT ${token}`
    },
    body
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = json ? JSON.stringify(json, null, 2) : text;
    throw new Error(`AMO ${method} ${url} failed (${res.status}):\n${msg}`);
  }

  return json;
}

async function uploadXpi({ baseUrl, token, xpiPath, channel }) {
  const buf = readFileSync(xpiPath);
  const form = new FormData();
  // AMO expects "channel" as a multipart field (validator error: Missing "channel" arg).
  form.append("channel", channel);
  form.append("upload", new Blob([buf]), "SyncNos-WebClipper-firefox.xpi");
  const json = await amoRequest({
    method: "POST",
    url: `${baseUrl}/addons/upload/`,
    token,
    body: form
  });
  if (!json || !json.uuid) throw new Error(`unexpected upload response: ${JSON.stringify(json)}`);
  return json.uuid;
}

async function waitUpload({ baseUrl, token, uuid }) {
  for (let i = 0; i < 120; i++) {
    const json = await amoRequest({
      method: "GET",
      url: `${baseUrl}/addons/upload/${uuid}/`,
      token
    });
    if (json && json.processed) return json;
    await sleep(2000);
  }
  throw new Error(`upload not processed in time: ${uuid}`);
}

async function createVersion({ baseUrl, token, addonId, uploadUuid, sourceZipPath }) {
  const buf = readFileSync(sourceZipPath);
  const form = new FormData();
  form.append("upload", uploadUuid);
  form.append("source", new Blob([buf]), "SyncNos-WebClipper-amo-source.zip");

  return await amoRequest({
    method: "POST",
    url: `${baseUrl}/addons/addon/${addonId}/versions/`,
    token,
    body: form
  });
}

async function main() {
  const issuer = requiredEnv("AMO_JWT_ISSUER");
  const secret = requiredEnv("AMO_JWT_SECRET");
  // AMO API accepts add-on numeric id, slug, or GUID for this path parameter.
  const addonId = requiredEnv("AMO_ADDON_ID");

  const repoRoot = resolveRepoRoot(import.meta.url);
  const webclipperRoot = resolveWebclipperRoot(repoRoot);
  const baseUrl = (process.env.AMO_BASE_URL || "https://addons.mozilla.org/api/v5").replace(/\/+$/g, "");
  const channel = (process.env.AMO_CHANNEL || "listed").trim();
  const xpiPath = process.env.AMO_XPI_PATH || join(webclipperRoot, "SyncNos-WebClipper-firefox.xpi");
  const sourceZipPath = process.env.AMO_SOURCE_ZIP_PATH || join(webclipperRoot, "SyncNos-WebClipper-amo-source.zip");

  const token = jwtHs256({ issuer, secret });

  // eslint-disable-next-line no-console
  console.log(`[amo] upload xpi: ${xpiPath}`);
  const uuid = await uploadXpi({ baseUrl, token, xpiPath, channel });
  // eslint-disable-next-line no-console
  console.log(`[amo] upload uuid: ${uuid}`);

  const upload = await waitUpload({ baseUrl, token, uuid });
  if (!upload.valid) {
    throw new Error(`[amo] upload invalid:\n${JSON.stringify(upload.validation || upload, null, 2)}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[amo] create version: addon_id=${addonId}`);
  const version = await createVersion({ baseUrl, token, addonId, uploadUuid: uuid, sourceZipPath });
  // eslint-disable-next-line no-console
  console.log(`[amo] version created:\n${JSON.stringify(version, null, 2)}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});

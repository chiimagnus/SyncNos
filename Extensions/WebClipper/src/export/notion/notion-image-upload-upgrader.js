(function () {
  const NS = require("../../runtime-context.js");

  function getNS() {
    return NS;
  }

  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

  function sanitizeUrlForLog(url) {
    try {
      const u = new URL(String(url || ""));
      const keys = [];
      for (const [k] of u.searchParams.entries()) keys.push(k);
      const uniqueKeys = Array.from(new Set(keys));
      const q = uniqueKeys.length ? `?keys=${uniqueKeys.slice(0, 12).join(",")}` : "";
      return `${u.origin}${u.pathname}${q}`;
    } catch (_e) {
      return String(url || "").slice(0, 120);
    }
  }

  function guessContentTypeFromUrl(url) {
    const s = String(url || "").toLowerCase();
    if (s.includes(".png")) return "image/png";
    if (s.includes(".jpg") || s.includes(".jpeg")) return "image/jpeg";
    if (s.includes(".webp")) return "image/webp";
    if (s.includes(".gif")) return "image/gif";
    if (s.includes(".svg")) return "image/svg+xml";
    return "";
  }

  function guessFilenameFromUrl(url) {
    const files = getNS().notionFilesApi;
    if (files && typeof files.guessFilenameFromUrl === "function") {
      return files.guessFilenameFromUrl(url);
    }
    try {
      const u = new URL(String(url || ""));
      const last = String(u.pathname || "").split("/").filter(Boolean).pop() || "";
      if (last && last.includes(".")) return last.slice(0, 120);
    } catch (_e) {
      // ignore
    }
    return "image.jpg";
  }

  async function downloadBytes(url) {
    if (typeof fetch !== "function") throw new Error("fetch missing");
    const target = String(url || "").trim();
    let credentials = "include";
    try {
      const u = new URL(target);
      // Attachment URLs may require Notion auth cookies on `notion.so`.
      // The redirected CDN (`notionusercontent.com`) should work without credentials.
      if (/(\.|^)notionusercontent\.com$/i.test(u.hostname)) credentials = "omit";
    } catch (_e) {
      // ignore
    }
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      credentials,
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" }
    });
    if (!res.ok) {
      const finalUrl = res && res.url ? String(res.url) : target;
      throw new Error(`image download failed HTTP ${res.status} ${sanitizeUrlForLog(finalUrl)}`);
    }
    const ct = res.headers && res.headers.get ? String(res.headers.get("content-type") || "") : "";
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return { bytes, contentType: ct.split(";")[0].trim(), contentLength: bytes.byteLength };
  }

  function toFileUploadImageBlock(block, uploadId) {
    return {
      ...block,
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: uploadId }
      }
    };
  }

  function canUpgrade(files) {
    return !!(
      files &&
      typeof files.createExternalURLUpload === "function" &&
      typeof files.waitUntilUploaded === "function" &&
      typeof files.createFileUpload === "function" &&
      typeof files.sendFileUpload === "function"
    );
  }

  async function uploadFromExternalUrl(files, accessToken, url) {
    const created = await files.createExternalURLUpload({ accessToken, url });
    const id = created && created.id ? String(created.id).trim() : "";
    if (!id) throw new Error("missing file upload id");
    const ready = await files.waitUntilUploaded({ accessToken, id });
    return ready && ready.id ? String(ready.id).trim() : id;
  }

  async function uploadFromBytes(files, accessToken, url) {
    const dl = await downloadBytes(url);
    if (!dl || !(dl.bytes instanceof Uint8Array) || !dl.bytes.byteLength) throw new Error("download empty");
    if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${dl.bytes.byteLength}`);
    const ct = dl.contentType || guessContentTypeFromUrl(url) || "application/octet-stream";
    const filename = guessFilenameFromUrl(url);
    const up = await files.createFileUpload({
      accessToken,
      filename,
      contentType: ct
    });
    const fileId = up && up.id ? String(up.id).trim() : "";
    if (!fileId) throw new Error("missing file upload id");
    await files.sendFileUpload({ accessToken, id: fileId, bytes: dl.bytes, filename, contentType: ct });
    const ready = await files.waitUntilUploaded({ accessToken, id: fileId });
    return ready && ready.id ? String(ready.id).trim() : fileId;
  }

  async function upgradeImageBlocksToFileUploads(accessToken, blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (!list.length) return [];
    const files = getNS().notionFilesApi;
    if (!canUpgrade(files)) return list;

    const cache = new Map();
    const out = [];

    for (const b of list) {
      if (!b || b.type !== "image" || !b.image || b.image.type !== "external") {
        out.push(b);
        continue;
      }
      const url = b.image && b.image.external && b.image.external.url ? String(b.image.external.url).trim() : "";
      if (!url) {
        out.push(b);
        continue;
      }

      let uploadId = cache.get(url) || "";
      if (!uploadId) {
        try {
          // eslint-disable-next-line no-await-in-loop
          uploadId = await uploadFromExternalUrl(files, accessToken, url);
          if (uploadId) cache.set(url, uploadId);
        } catch (e) {
          const brief = sanitizeUrlForLog(url);
          const msg = e && e.message ? String(e.message) : String(e);
          try {
            console.warn("[NotionImageUpload] external_url failed:", brief, msg);
          } catch (_e2) {
            // ignore
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            uploadId = await uploadFromBytes(files, accessToken, url);
            if (uploadId) cache.set(url, uploadId);
          } catch (e2) {
            const msg2 = e2 && e2.message ? String(e2.message) : String(e2);
            try {
              console.warn("[NotionImageUpload] byte upload failed:", brief, msg2);
            } catch (_e3) {
              // ignore
            }
            uploadId = "";
          }
        }
      }

      if (!uploadId) {
        out.push(b);
        continue;
      }

      out.push(toFileUploadImageBlock(b, uploadId));
    }

    return out;
  }

  const api = {
    upgradeImageBlocksToFileUploads
  };

  getNS().notionImageUploadUpgrader = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

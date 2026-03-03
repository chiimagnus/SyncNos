import { describe, expect, it } from "vitest";

async function loadNotionSyncService() {
  const mod = await import(
    /* @vite-ignore */
    `../../src/sync/notion/notion-sync-service.ts?t=${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
  return (mod as any).default || mod;
}

describe("notion-sync-service image uploads", () => {
  it("upgrades external image blocks via external_url upload", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper.notionFilesApi = {
      createExternalURLUpload: async ({ url }: any) => {
        calls.push({ op: "createExternalURLUpload", url });
        return { id: "u1" };
      },
      waitUntilUploaded: async ({ id }: any) => {
        calls.push({ op: "waitUntilUploaded", id });
        return { id, status: "uploaded" };
      },
      createFileUpload: async () => {
        throw new Error("should not be called");
      },
      sendFileUpload: async () => {
        throw new Error("should not be called");
      },
      // `sendFileUpload` not used in this test.
    };

    const service = await loadNotionSyncService();
    const blocks = [{
      object: "block",
      type: "image",
      image: { type: "external", external: { url: "https://example.com/a.png" } }
    }];

    const out = await service.upgradeImageBlocksToFileUploads("t", blocks);
    expect(out[0]?.image?.type).toBe("file_upload");
    expect(out[0]?.image?.file_upload?.id).toBe("u1");
    expect(calls.map((c) => c.op)).toEqual(["createExternalURLUpload", "waitUntilUploaded"]);
  });

  it("falls back to byte upload when external_url upload fails", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string) => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      };
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionFilesApi = {
      createExternalURLUpload: async () => {
        calls.push({ op: "createExternalURLUpload" });
        throw new Error("validation_error");
      },
      createFileUpload: async ({ filename, contentType, contentLength }: any) => {
        calls.push({ op: "createFileUpload", filename, contentType, contentLength });
        return { id: "u2" };
      },
      sendFileUpload: async ({ id, bytes, filename, contentType }: any) => {
        calls.push({ op: "sendFileUpload", id, byteLength: bytes.byteLength, filename, contentType });
        return { id };
      },
      waitUntilUploaded: async ({ id }: any) => {
        calls.push({ op: "waitUntilUploaded", id });
        return { id, status: "uploaded" };
      }
    };

    const service = await loadNotionSyncService();
    const blocks = [{
      object: "block",
      type: "image",
      image: { type: "external", external: { url: "https://www.notion.so/image/attachment%3Aabc.png?table=thread&id=1" } }
    }];

    const out = await service.upgradeImageBlocksToFileUploads("t", blocks);
    expect(out[0]?.image?.type).toBe("file_upload");
    expect(out[0]?.image?.file_upload?.id).toBe("u2");
    expect(calls.map((c) => c.op)).toEqual([
      "createExternalURLUpload",
      "createFileUpload",
      "sendFileUpload",
      "waitUntilUploaded"
    ]);
  });

  it("keeps original external url when all upload attempts fail", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    };

    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper.notionFilesApi = {
      createExternalURLUpload: async () => {
        calls.push({ op: "createExternalURLUpload" });
        throw new Error("validation_error");
      },
      createFileUpload: async () => {
        calls.push({ op: "createFileUpload" });
        throw new Error("nope");
      },
      sendFileUpload: async () => {
        calls.push({ op: "sendFileUpload" });
        throw new Error("nope");
      },
      waitUntilUploaded: async () => {
        calls.push({ op: "waitUntilUploaded" });
        throw new Error("nope");
      }
    };

    const service = await loadNotionSyncService();
    const blocks = [{
      object: "block",
      type: "image",
      image: { type: "external", external: { url: "https://www.notion.so/image/attachment%3Aabc.png?table=thread&id=1" } }
    }];

    const out = await service.upgradeImageBlocksToFileUploads("t", blocks);
    expect(out[0]?.image?.type).toBe("external");
    expect(out[0]?.image?.external?.url).toContain("/image/attachment%3A");
    expect(calls.map((c) => c.op)).toEqual(["createExternalURLUpload"]);
  });
});

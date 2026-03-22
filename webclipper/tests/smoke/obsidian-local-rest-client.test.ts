import { describe, expect, it } from "vitest";

async function loadClient() {
  const mod = await import("@services/sync/obsidian/obsidian-local-rest-client.ts");
  return mod.default || mod;
}

describe("obsidian-local-rest-client", () => {
  it("encodes vault path segments without encoding slashes", async () => {
    const mod = await loadClient();
    expect(mod.encodeVaultPath("A Folder/My Note.md")).toBe("A%20Folder/My%20Note.md");
  });

  it("rejects https base url in this version", async () => {
    const mod = await loadClient();
    const client = mod.createClient({ apiBaseUrl: "https://127.0.0.1:27124", apiKey: "k" });
    expect(client.ok).toBe(false);
    expect(client.error?.code).toBe("https_unsupported");
  });

  it("injects bearer auth header and supports custom header name", async () => {
    const seen: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (url: any, init: any) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const mod = await loadClient();
    const client = mod.createClient({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k", authHeaderName: "X-Api-Key" });
    expect(client.ok).toBe(true);

    // @ts-expect-error narrowed
    const res = await client.getVaultFile("Folder/Note.md");
    expect(res.ok).toBe(true);
    expect(seen.length).toBe(1);
    expect(String(seen[0].url)).toContain("/vault/Folder/Note.md");

    const headers = seen[0].init.headers as Headers;
    expect(headers.get("X-Api-Key")).toBe("Bearer k");
  });

  it("supports listVaultDir and deleteVaultFile routes", async () => {
    const seen: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (url: any, init: any) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true, files: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const mod = await loadClient();
    const client = mod.createClient({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    expect(client.ok).toBe(true);

    // @ts-expect-error narrowed
    await client.listVaultDir("A Folder");
    expect(String(seen[0].url)).toContain("/vault/A%20Folder/");
    expect(String(seen[0].init.method || "")).toBe("GET");

    // @ts-expect-error narrowed
    await client.deleteVaultFile("A Folder/Note.md");
    expect(String(seen[1].url)).toContain("/vault/A%20Folder/Note.md");
    expect(String(seen[1].init.method || "")).toBe("DELETE");
  });

  it("supports openVaultFile route for opening an existing note in the app", async () => {
    const seen: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (url: any, init: any) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const mod = await loadClient();
    const client = mod.createClient({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    expect(client.ok).toBe(true);

    // @ts-expect-error narrowed
    await client.openVaultFile("A Folder/Note.md");
    expect(String(seen[0].url)).toContain("/open/A%20Folder/Note.md");
    expect(String(seen[0].init.method || "")).toBe("POST");
  });

  it("normalizes 401 as auth_error with message", async () => {
    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ errorCode: 40100, message: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    };
    const mod = await loadClient();
    const client = mod.createClient({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "bad" });
    expect(client.ok).toBe(true);

    // @ts-expect-error narrowed
    const res = await client.getVaultFile("Folder/Note.md");
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("auth_error");
    expect(String(res.error?.message || "")).toContain("unauthorized");
  });
});

import { describe, expect, it } from "vitest";

function loadModule() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-obsidian-sync.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-obsidian-sync.js");
}

describe("popup-obsidian-sync", () => {
  it("reads UI payload and keeps apiKey when input is empty", () => {
    const els: any = {
      obsidianApiBaseUrl: { value: "http://127.0.0.1:27123" },
      obsidianAuthHeaderName: { value: "Authorization" },
      obsidianApiKey: { value: "   " }
    };
    // @ts-expect-error test global
    globalThis.WebClipper = {
      popupCore: { els, send: async () => ({}), flashOk: () => {} },
      messageContracts: { OBSIDIAN_MESSAGE_TYPES: {} }
    };
    const api = loadModule();
    const payload = api.__test.readUiPayload();
    expect(payload.apiBaseUrl).toContain("http://127.0.0.1:27123");
    expect(payload.apiKey).toBe(null);
  });

  it("applies settings to UI with masked api key placeholder", () => {
    const els: any = {
      obsidianApiBaseUrl: { value: "" },
      obsidianAuthHeaderName: { value: "" },
      obsidianApiKey: { value: "x", placeholder: "" }
    };
    // @ts-expect-error test global
    globalThis.WebClipper = {
      popupCore: { els, send: async () => ({}), flashOk: () => {} },
      messageContracts: { OBSIDIAN_MESSAGE_TYPES: {} }
    };
    const api = loadModule();
    api.__test.applySettingsToUi({
      apiBaseUrl: "http://127.0.0.1:27123",
      authHeaderName: "Authorization",
      apiKeyPresent: true
    });
    expect(els.obsidianApiBaseUrl.value).toContain("http://127.0.0.1:27123");
    expect(typeof els.obsidianApiKey.value).toBe("string");
    expect(els.obsidianApiKey.value.length).toBeGreaterThan(10);
    expect(els.obsidianApiKey.placeholder).toBe("");
  });
});

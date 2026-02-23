import { afterEach, describe, expect, it } from "vitest";

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("background-router open extension popup", () => {
  it("opens popup via chrome.action.openPopup when supported", async () => {
    const calls: string[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = { backgroundStorage: {} };
    // @ts-expect-error test global
    globalThis.chrome = {
      action: {
        openPopup: async () => {
          calls.push("open");
        }
      }
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "openExtensionPopup" });

    expect(res.ok).toBe(true);
    expect(res.data?.opened).toBe(true);
    expect(calls).toEqual(["open"]);
  });

  it("returns unsupported error when action.openPopup is unavailable", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = { backgroundStorage: {} };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "openExtensionPopup" });

    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe("OPEN_POPUP_UNSUPPORTED");
  });

  it("returns failed error when action.openPopup throws", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = { backgroundStorage: {} };
    // @ts-expect-error test global
    globalThis.chrome = {
      action: {
        openPopup: async () => {
          throw new Error("user gesture required");
        }
      }
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "openExtensionPopup" });

    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe("OPEN_POPUP_FAILED");
    expect(String(res.error?.message || "")).toContain("user gesture required");
  });
});

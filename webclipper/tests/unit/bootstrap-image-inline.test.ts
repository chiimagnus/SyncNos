import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inlineSameOriginImagesInSnapshot } from "../../src/bootstrap/image-inline";

function installBtoa() {
  // Node doesn't always expose btoa in the test runtime.
  // @ts-expect-error test global
  globalThis.btoa = (binary: string) => Buffer.from(binary, "binary").toString("base64");
}

describe("bootstrap/image-inline", () => {
  const originalLocation = globalThis.location;
  const originalDocument = (globalThis as any).document;
  const originalImage = (globalThis as any).Image;

  beforeEach(() => {
    installBtoa();
    // @ts-expect-error test global
    globalThis.location = { origin: "https://chatgpt.com", href: "https://chatgpt.com/c/test" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test global
    globalThis.location = originalLocation;
    // @ts-expect-error test global
    (globalThis as any).document = originalDocument;
    // @ts-expect-error test global
    (globalThis as any).Image = originalImage;
  });

  it("prefers <img> pipeline for ChatGPT estuary urls", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be used for estuary urls in this test");
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: (cb: (blob: Blob | null) => void, type?: string) => {
        cb(new Blob([Uint8Array.from([1, 2, 3, 4])], { type: type || "image/png" }));
      },
    };

    // @ts-expect-error test global
    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => {
        if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
        return canvas;
      }),
    };

    class FakeImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      naturalWidth = 10;
      naturalHeight = 10;
      width = 10;
      height = 10;
      decoding = "async";
      referrerPolicy = "no-referrer";
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error test global
    (globalThis as any).Image = FakeImage;

    const snapshot: any = {
      conversation: { url: "https://chatgpt.com/c/test" },
      messages: [
        {
          messageKey: "m1",
          role: "assistant",
          sequence: 1,
          contentMarkdown: "![](https://chatgpt.com/backend-api/estuary/content?id=file_x&sig=y)",
        },
      ],
    };

    const res = await inlineSameOriginImagesInSnapshot({ snapshot });
    expect(res.inlinedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(String(snapshot.messages[0].contentMarkdown)).toMatch(/^!\[\]\(data:image\/png;base64,/);
    expect(res.warningFlags).toEqual([]);
  });

  it("retries with img.currentSrc when canvas is tainted after redirect", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be used in this test");
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const drawImage = vi.fn();
    let toBlobCalls = 0;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: (_cb: (blob: Blob | null) => void) => {
        toBlobCalls += 1;
        if (toBlobCalls === 1) throw new Error("SecurityError: The canvas has been tainted by cross-origin data.");
        _cb(new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "image/png" }));
      },
    };

    // @ts-expect-error test global
    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => {
        if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
        return canvas;
      }),
    };

    const created: any[] = [];
    class FakeImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      naturalWidth = 10;
      naturalHeight = 10;
      width = 10;
      height = 10;
      decoding = "async";
      crossOrigin: string | null = null;
      currentSrc = "";
      set src(value: string) {
        this.currentSrc = value.includes("backend-api/estuary")
          ? "https://oaidalleapiprodscus.blob.core.windows.net/public/signed.png"
          : value;
        queueMicrotask(() => this.onload?.());
      }
      constructor() {
        created.push(this);
      }
    }
    // @ts-expect-error test global
    (globalThis as any).Image = FakeImage;

    const snapshot: any = {
      conversation: { url: "https://chatgpt.com/c/test" },
      messages: [
        {
          messageKey: "m1",
          role: "assistant",
          sequence: 1,
          contentMarkdown: "![](https://chatgpt.com/backend-api/estuary/content?id=file_x&sig=y)",
        },
      ],
    };

    const res = await inlineSameOriginImagesInSnapshot({ snapshot });
    expect(res.inlinedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(toBlobCalls).toBe(2);
    expect(created.length).toBe(2);
    expect(created[1]?.crossOrigin).toBe("anonymous");
    expect(String(snapshot.messages[0].contentMarkdown)).toMatch(/^!\[\]\(data:image\/png;base64,/);
  });
});

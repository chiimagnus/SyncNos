import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://chatgpt.com/",
    pretendToBeVisual: true
  });

  // @ts-expect-error test global
  global.window = dom.window;
  // @ts-expect-error test global
  global.document = dom.window.document;
  // @ts-expect-error test global
  global.HTMLElement = dom.window.HTMLElement;
  // @ts-expect-error test global
  global.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.WebClipper = {};

  return dom;
}

function loadInpageTip() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/inpage/inpage-tip.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/inpage/inpage-tip.js");
}

function appendIconRect(rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }) {
  const btn = document.createElement("button");
  btn.id = "webclipper-inpage-btn";
  btn.getBoundingClientRect = () => rect as DOMRect;
  document.body.appendChild(btn);
  return btn;
}

describe("inpage-tip speech bubble", () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    // @ts-expect-error test global cleanup
    delete global.window;
    // @ts-expect-error test global cleanup
    delete global.document;
    // @ts-expect-error test global cleanup
    delete global.HTMLElement;
    // @ts-expect-error test global cleanup
    delete global.Node;
    // @ts-expect-error test global cleanup
    delete globalThis.WebClipper;
  });

  it("creates anchored bubble with kind and inward placement", () => {
    appendIconRect({ left: 900, right: 940, top: 500, bottom: 540, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Save failed", { kind: "error" });

    const bubble = document.getElementById("webclipper-inpage-bubble");
    expect(bubble).toBeTruthy();
    expect(bubble?.dataset.kind).toBe("error");
    expect(bubble?.dataset.placement).toBe("left");
    expect(bubble?.textContent).toContain("Save failed");
  });

  it("reuses singleton bubble and replaces text on rapid updates", () => {
    appendIconRect({ left: 20, right: 60, top: 400, bottom: 440, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Loading full history...", { kind: "loading" });
    api.showSaveTip("Save failed", { kind: "error" });

    const nodes = document.querySelectorAll("#webclipper-inpage-bubble");
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain("Save failed");
    expect(nodes[0].dataset.kind).toBe("error");
  });

  it("removes bubble after 1800ms", () => {
    vi.useFakeTimers();
    appendIconRect({ left: 20, right: 60, top: 400, bottom: 440, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Loading full history...", { kind: "loading" });
    expect(document.getElementById("webclipper-inpage-bubble")).toBeTruthy();

    vi.advanceTimersByTime(1801);
    expect(document.getElementById("webclipper-inpage-bubble")).toBeNull();
  });
});

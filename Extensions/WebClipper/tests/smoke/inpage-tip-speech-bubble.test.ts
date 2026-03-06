import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { inpageTipApi } from "../../src/ui/inpage/inpage-tip-shadow";

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
  Object.defineProperty(dom.window, "innerWidth", { value: 1000, configurable: true, writable: true });
  Object.defineProperty(dom.window, "innerHeight", { value: 800, configurable: true, writable: true });

  return dom;
}

function loadInpageTip() {
  return inpageTipApi;
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
  });

  it("creates anchored bubble with kind and inward placement", () => {
    appendIconRect({ left: 900, right: 940, top: 500, bottom: 540, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Save failed", { kind: "error" });

    const bubble = document.getElementById("webclipper-inpage-bubble");
    expect(bubble).toBeTruthy();
    expect(bubble?.tagName).toBe("WEBCLIPPER-INPAGE-BUBBLE");
    expect(bubble?.dataset.kind).toBe("error");
    expect(bubble?.dataset.placement).toBe("left");
    expect(bubble?.shadowRoot?.textContent).toContain("Save failed");
  });

  it.each([
    { name: "left edge", rect: { left: 2, right: 42, top: 360, bottom: 400, width: 40, height: 40 }, expected: "right" },
    {
      name: "right edge",
      rect: { left: 958, right: 998, top: 360, bottom: 400, width: 40, height: 40 },
      expected: "left"
    },
    { name: "top edge", rect: { left: 470, right: 510, top: 2, bottom: 42, width: 40, height: 40 }, expected: "bottom" },
    {
      name: "bottom edge",
      rect: { left: 470, right: 510, top: 758, bottom: 798, width: 40, height: 40 },
      expected: "top"
    }
  ])("uses inward placement for $name", ({ rect, expected }) => {
    appendIconRect(rect);
    const api = loadInpageTip();

    api.showSaveTip("tip", { kind: "loading" });
    expect(document.getElementById("webclipper-inpage-bubble")?.dataset.placement).toBe(expected);
  });

  it("reuses singleton bubble and replaces text on rapid updates", () => {
    appendIconRect({ left: 20, right: 60, top: 400, bottom: 440, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Loading full history...", { kind: "loading" });
    api.showSaveTip("Save failed", { kind: "error" });

    const nodes = document.querySelectorAll("#webclipper-inpage-bubble");
    expect(nodes.length).toBe(1);
    expect((nodes[0] as any).shadowRoot?.textContent).toContain("Save failed");
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

  it("clears enter class after animation window", () => {
    vi.useFakeTimers();
    appendIconRect({ left: 20, right: 60, top: 400, bottom: 440, width: 40, height: 40 });
    const api = loadInpageTip();

    api.showSaveTip("Loading full history...", { kind: "loading" });
    const bubble = document.getElementById("webclipper-inpage-bubble");
    expect(bubble?.classList.contains("is-enter")).toBe(true);

    vi.advanceTimersByTime(341);
    expect(bubble?.classList.contains("is-enter")).toBe(false);
  });
});

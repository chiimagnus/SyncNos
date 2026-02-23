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
  global.localStorage = dom.window.localStorage;
  // @ts-expect-error test global
  globalThis.WebClipper = {};

  return dom;
}

function loadInpageButton() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/inpage/inpage-button.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/inpage/inpage-button.js");
}

describe("inpage-button click combos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    // @ts-expect-error cleanup
    delete global.window;
    // @ts-expect-error cleanup
    delete global.document;
    // @ts-expect-error cleanup
    delete global.localStorage;
    // @ts-expect-error cleanup
    delete globalThis.WebClipper;
  });

  it("fires single-click save only after combo window settles", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save")
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(calls).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(calls).toEqual(["save"]);
  });

  it("settles exact double-click after 400ms and triggers popup callback", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save"),
      onDoubleClick: () => calls.push("double")
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(calls).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(calls).toEqual(["double"]);
  });

  it("uses highest combo level and suppresses double when count >= 3", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save"),
      onDoubleClick: () => calls.push("double"),
      onCombo: ({ level, count }: { level: number; count: number }) => calls.push(`combo:${level}:${count}`)
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    for (let i = 0; i < 5; i += 1) {
      btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    }

    vi.advanceTimersByTime(401);
    expect(calls).toEqual(["combo:5:5"]);
    expect(btn?.classList.contains("is-easter-5")).toBe(true);
    vi.advanceTimersByTime(761);
    expect(btn?.classList.contains("is-easter-5")).toBe(false);
  });

  it("triggers level 3 combo for exact triple click without double callback", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save"),
      onDoubleClick: () => calls.push("double"),
      onCombo: ({ level, count }: { level: number; count: number }) => calls.push(`combo:${level}:${count}`)
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    for (let i = 0; i < 3; i += 1) {
      btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    }

    vi.advanceTimersByTime(401);
    expect(calls).toEqual(["combo:3:3"]);
    expect(btn?.classList.contains("is-easter-3")).toBe(true);
  });

  it("maps 7+ clicks to level 7 combo", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save"),
      onCombo: ({ level, count }: { level: number; count: number }) => calls.push(`combo:${level}:${count}`)
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    for (let i = 0; i < 8; i += 1) {
      btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    }

    vi.advanceTimersByTime(401);
    expect(calls).toEqual(["combo:7:8"]);
    expect(btn?.classList.contains("is-easter-7")).toBe(true);
  });

  it("cleans pending combo timer when button is removed", () => {
    const api = loadInpageButton();
    const calls: string[] = [];

    api.ensureInpageButton({
      collectorId: "gemini",
      onClick: () => calls.push("save"),
      onDoubleClick: () => calls.push("double")
    });

    const btn = document.getElementById("webclipper-inpage-btn");
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    btn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    api.cleanupButtons("");

    vi.advanceTimersByTime(401);
    expect(calls).toEqual([]);
  });
});

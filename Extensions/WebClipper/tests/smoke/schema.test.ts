import { describe, expect, it } from "vitest";

// These are UMD-ish modules: they attach to globalThis for the extension, and also export via module.exports for Node tests.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const normalize = require("../../src/shared/normalize.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const incrementalUpdater = require("../../src/storage/incremental-updater.js");

describe("smoke", () => {
  it("normalizeText trims and normalizes newlines", () => {
    expect(normalize.normalizeText(" a \r\nb \r c\t \n")).toBe("a\nb\nc");
  });

  it("fnv1a32 is stable", () => {
    expect(normalize.fnv1a32("hello")).toBe(normalize.fnv1a32("hello"));
    expect(normalize.fnv1a32("hello")).not.toBe(normalize.fnv1a32("hello!"));
  });

  it("computeIncremental detects changes by messageKey sequence", () => {
    incrementalUpdater.__resetForTests();
    const snap1 = { conversation: { conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m2" }] };
    const snap2 = { conversation: { conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m2" }] };
    const snap3 = { conversation: { conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m3" }] };

    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(false);
    expect(incrementalUpdater.computeIncremental(snap3).changed).toBe(true);
  });

  it("computeIncremental detects content update for same messageKey", () => {
    incrementalUpdater.__resetForTests();
    const snap1 = { conversation: { conversationKey: "c1" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const snap2 = { conversation: { conversationKey: "c1" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi!" }] };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(true);
  });
});

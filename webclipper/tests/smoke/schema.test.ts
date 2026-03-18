import { describe, expect, it } from "vitest";
import * as normalize from "../../src/shared/normalize.ts";
import * as incrementalUpdater from "../../src/conversations/content/incremental-updater.ts";

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
    const snap1 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m2" }] };
    const snap2 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m2" }] };
    const snap3 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ messageKey: "m1" }, { messageKey: "m3" }] };

    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(false);
    expect(incrementalUpdater.computeIncremental(snap3).changed).toBe(true);
  });

  it("computeIncremental detects content update for same messageKey", () => {
    incrementalUpdater.__resetForTests();
    const snap1 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const snap2 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi!" }] };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(true);
  });

  it("computeIncremental uses stable fallback keys for auto-save", () => {
    incrementalUpdater.__resetForTests();
    const snap1 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ role: "assistant", contentText: "hello" }] };
    const snap2 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ role: "assistant", contentText: "hello!" }] };

    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true);
    expect(r1.diff.added.length).toBe(1);
    expect(r1.diff.updated.length).toBe(0);
    expect(String(snap1.messages[0].messageKey || "")).toMatch(/^autosave_/);

    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.added.length).toBe(0);
    expect(r2.diff.updated.length).toBe(1);
    expect(r2.diff.removed.length).toBe(0);
    expect(snap2.messages[0].messageKey).toBe(snap1.messages[0].messageKey);
  });

  it("computeIncremental does not overwrite history when the visible window shifts", () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { role: "user", contentText: "A" },
        { role: "assistant", contentText: "B" },
        { role: "user", contentText: "C" },
      ],
    };
    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true);
    expect(r1.diff.removed.length).toBe(0);

    const keyA = String(snap1.messages[0].messageKey || "");
    expect(keyA).toMatch(/^autosave_/);

    // Simulate a virtualized list: the top part gets recycled and capture starts from the middle.
    const snap2 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { role: "assistant", contentText: "B" },
        { role: "user", contentText: "C" },
        { role: "assistant", contentText: "D" },
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.removed.length).toBe(0);

    // The new first visible message must not reuse the key previously assigned to "A".
    expect(String(snap2.messages[0].messageKey || "")).not.toBe(keyA);
  });

  it("computeIncremental updates only within the tail window (N=2) on prefix growth", () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { role: "user", contentText: "A" },
        { role: "assistant", contentText: "B" },
        { role: "assistant", contentText: "C" },
      ],
    };
    incrementalUpdater.computeIncremental(snap1);
    const keyB = String(snap1.messages[1].messageKey || "");
    const keyC = String(snap1.messages[2].messageKey || "");

    const snap2 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { role: "user", contentText: "A" },
        { role: "assistant", contentText: "B!!!" }, // grows (second-last)
        { role: "assistant", contentText: "C" }, // unchanged (last)
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.added.length).toBe(0);
    expect(r2.diff.updated).toEqual([keyB]);
    expect(r2.diff.removed.length).toBe(0);

    expect(String(snap2.messages[1].messageKey || "")).toBe(keyB);
    expect(String(snap2.messages[2].messageKey || "")).toBe(keyC);
  });

  it("computeIncremental treats a new message as added (no false tail update)", () => {
    incrementalUpdater.__resetForTests();

    const snap1 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ role: "assistant", contentText: "hello" }] };
    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true);
    const key1 = String(snap1.messages[0].messageKey || "");

    const snap2 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { role: "assistant", contentText: "hello" },
        { role: "assistant", contentText: "new" },
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.updated.length).toBe(0);
    expect(r2.diff.added.length).toBe(1);
    expect(r2.diff.removed.length).toBe(0);

    expect(String(snap2.messages[0].messageKey || "")).toBe(key1);
    expect(String(snap2.messages[1].messageKey || "")).not.toBe(key1);
  });

  it("computeIncremental ignores unstable incoming messageKey reuse across window shift", () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { messageKey: "k0", role: "user", contentText: "A" },
        { messageKey: "k1", role: "assistant", contentText: "B" },
        { messageKey: "k2", role: "user", contentText: "C" },
      ],
    };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true);

    // Window shifts but the collector reuses index-based keys (k0/k1/k2) for different messages.
    const snap2 = {
      conversation: { source: "debug", conversationKey: "c1" },
      messages: [
        { messageKey: "k0", role: "assistant", contentText: "B" },
        { messageKey: "k1", role: "user", contentText: "C" },
        { messageKey: "k2", role: "assistant", contentText: "D" },
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.removed.length).toBe(0);

    // Must not accept the conflicting incoming key (k0) for message "B".
    expect(String(snap2.messages[0].messageKey || "")).not.toBe("k0");
  });

  it("computeIncremental isolates state by source and conversationKey", () => {
    incrementalUpdater.__resetForTests();

    const snap1 = { conversation: { source: "debug", conversationKey: "c1" }, messages: [{ role: "user", contentText: "A" }] };
    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true);

    const snap2 = { conversation: { source: "debug", conversationKey: "c2" }, messages: [{ role: "user", contentText: "B" }] };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);

    // Different conversations should not share autosave state.
    expect(String(snap2.messages[0].messageKey || "")).not.toBe(String(snap1.messages[0].messageKey || ""));
  });

  it("computeIncremental detects title/url updates even without message changes", () => {
    incrementalUpdater.__resetForTests();
    const base = { conversation: { source: "debug", conversationKey: "c1", title: "t1", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const sameMsgsNewTitle = { conversation: { source: "debug", conversationKey: "c1", title: "t2", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const sameMsgsNewUrl = { conversation: { source: "debug", conversationKey: "c1", title: "t2", url: "https://b" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(sameMsgsNewTitle).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(sameMsgsNewUrl).changed).toBe(true);
  });

  it("computeIncremental does not treat empty title/url as an update for same conversationKey", () => {
    incrementalUpdater.__resetForTests();
    const base = { conversation: { source: "debug", conversationKey: "c1", title: "t1", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const emptyMeta = { conversation: { source: "debug", conversationKey: "c1", title: "", url: "" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(emptyMeta).changed).toBe(false);
    // And it should carry forward the previous non-empty values.
    expect(emptyMeta.conversation.title).toBe("t1");
    expect(emptyMeta.conversation.url).toBe("https://a");
  });
});

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

  it("computeIncremental uses stable fallback keys for auto-save", () => {
    incrementalUpdater.__resetForTests();
    const snap1 = { conversation: { conversationKey: "c1" }, messages: [{ role: "assistant", contentText: "hello" }] };
    const snap2 = { conversation: { conversationKey: "c1" }, messages: [{ role: "assistant", contentText: "hello!" }] };

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

  it("computeIncremental detects title/url updates even without message changes", () => {
    incrementalUpdater.__resetForTests();
    const base = { conversation: { conversationKey: "c1", title: "t1", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const sameMsgsNewTitle = { conversation: { conversationKey: "c1", title: "t2", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const sameMsgsNewUrl = { conversation: { conversationKey: "c1", title: "t2", url: "https://b" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(sameMsgsNewTitle).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(sameMsgsNewUrl).changed).toBe(true);
  });

  it("computeIncremental does not treat empty title/url as an update for same conversationKey", () => {
    incrementalUpdater.__resetForTests();
    const base = { conversation: { conversationKey: "c1", title: "t1", url: "https://a" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };
    const emptyMeta = { conversation: { conversationKey: "c1", title: "", url: "" }, messages: [{ messageKey: "m1", role: "user", contentText: "hi" }] };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(emptyMeta).changed).toBe(false);
    // And it should carry forward the previous non-empty values.
    expect(emptyMeta.conversation.title).toBe("t1");
    expect(emptyMeta.conversation.url).toBe("https://a");
  });
});

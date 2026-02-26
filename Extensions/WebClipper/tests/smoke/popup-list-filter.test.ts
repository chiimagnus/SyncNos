import { describe, expect, it } from "vitest";

function loadPopupList() {
  // @ts-expect-error test global
  globalThis.WebClipper = {
    popupCore: {
      els: {},
      state: {
        conversations: [],
        allConversations: [],
        selectedIds: new Set(),
        sourceFilterKey: "all"
      },
      send: async () => ({ ok: true, data: [] }),
      storageGet: async () => ({}),
      storageSet: async () => true,
      PREVIEW_EVENTS: { click: "popup:conversation-click" },
      formatTime: () => "",
      getSourceMeta: (raw: any) => {
        const text = String(raw || "").toLowerCase().replace(/[\s_-]+/g, "");
        if (text === "notionai") return { key: "notionai", label: "Notion AI" };
        return { key: text || "unknown", label: String(raw || "") };
      },
      hasWarningFlags: () => false,
      isSameLocalDay: () => false,
      copyTextToClipboard: async () => true,
      conversationToMarkdown: () => ""
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-list.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-list.js");
}

describe("popup-list filter", () => {
  it("filters conversations by selected source key", () => {
    const api = loadPopupList();
    const items = [
      { id: 1, source: "chatgpt", title: "A" },
      { id: 2, source: "notionai", title: "B" },
      { id: 3, sourceName: "Notion AI", title: "C" }
    ];

    const filtered = api.__test.applySourceFilter(items, { sourceKey: "notionai" });
    expect(filtered.map((x: any) => x.id)).toEqual([2, 3]);
  });

  it("returns all conversations when source key is all", () => {
    const api = loadPopupList();
    const items = [
      { id: 1, source: "chatgpt" },
      { id: 2, source: "notionai" }
    ];
    const filtered = api.__test.applySourceFilter(items, { sourceKey: "all" });
    expect(filtered.length).toBe(2);
  });
});

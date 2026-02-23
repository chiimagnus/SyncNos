import { describe, expect, it } from "vitest";

function loadPopupConversationDocs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-conversation-docs.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-conversation-docs.js");
}

describe("popup-conversation-docs", () => {
  it("throws when nothing is selected", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      popupCore: {
        state: {
          conversations: [{ id: 1, title: "a" }]
        },
        send: async () => ({ ok: true, data: { messages: [] } }),
        conversationToMarkdown: () => "# x"
      },
      messageContracts: {
        CORE_MESSAGE_TYPES: {
          GET_CONVERSATION_DETAIL: "getConversationDetail"
        }
      }
    };

    const api = loadPopupConversationDocs();
    await expect(api.buildConversationDocs({ selectedIds: [] })).rejects.toThrow("No conversations selected.");
    await expect(api.buildConversationDocs({ selectedIds: [], throwOnEmpty: false })).resolves.toEqual([]);
  });

  it("builds docs for selected conversations", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      popupCore: {
        state: {
          conversations: [
            { id: 1, title: "A", source: "chatgpt" },
            { id: 2, title: "B", source: "claude" }
          ]
        },
        send: async (type: string, payload: any) => {
          calls.push({ type, payload });
          return {
            ok: true,
            data: {
              messages: [{ messageKey: `m_${payload.conversationId}`, role: "assistant", contentText: "ok" }]
            }
          };
        },
        conversationToMarkdown: ({ conversation, messages }: any) => `# ${conversation.title}\n${messages.length}`
      },
      messageContracts: {
        CORE_MESSAGE_TYPES: {
          GET_CONVERSATION_DETAIL: "getConversationDetail"
        }
      }
    };

    const api = loadPopupConversationDocs();
    const docs = await api.buildConversationDocs({ selectedIds: [1, 2] });
    expect(docs.length).toBe(2);
    expect(docs[0].markdown).toBe("# A\n1");
    expect(docs[1].markdown).toBe("# B\n1");
    expect(calls.map((c) => c.type)).toEqual(["getConversationDetail", "getConversationDetail"]);
  });

  it("throws when conversation detail loading fails", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      popupCore: {
        state: {
          conversations: [{ id: 1, title: "A", source: "chatgpt" }]
        },
        send: async () => ({ ok: false, error: { message: "detail failed" } }),
        conversationToMarkdown: () => "# A"
      },
      messageContracts: {
        CORE_MESSAGE_TYPES: {
          GET_CONVERSATION_DETAIL: "getConversationDetail"
        }
      }
    };

    const api = loadPopupConversationDocs();
    await expect(api.buildConversationDocs({ selectedIds: [1] })).rejects.toThrow("detail failed");
  });
});

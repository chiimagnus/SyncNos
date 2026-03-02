import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestBackgroundRouter } from "./background-router-testkit";

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("background-router conversations events", () => {
  it("broadcasts conversationsChanged after syncConversationMessages", async () => {
    const broadcast = vi.fn();
    const syncConversationMessages = vi.fn(async () => ({ upserted: 1, deleted: 0 }));

    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: { syncConversationMessages }
    };

    const router = createTestBackgroundRouter();
    router.eventsHub.broadcast = broadcast;
    const res = await router.__handleMessageForTests({
      type: "syncConversationMessages",
      conversationId: 123,
      messages: []
    });

    expect(res.ok).toBe(true);
    expect(syncConversationMessages).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("conversationsChanged", { reason: "upsert", conversationId: 123 });
  });

  it("broadcasts conversationsChanged after deleteConversations", async () => {
    const broadcast = vi.fn();
    const deleteConversationsByIds = vi.fn(async () => ({ deletedConversations: 2, deletedMessages: 0, deletedMappings: 0 }));

    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: { deleteConversationsByIds }
    };

    const router = createTestBackgroundRouter();
    router.eventsHub.broadcast = broadcast;
    const res = await router.__handleMessageForTests({
      type: "deleteConversations",
      conversationIds: [1, "2", "bad", -1]
    });

    expect(res.ok).toBe(true);
    expect(deleteConversationsByIds).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("conversationsChanged", { reason: "delete", conversationIds: [1, 2] });
  });
});

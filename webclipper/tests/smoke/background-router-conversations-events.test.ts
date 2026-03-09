import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRouter } from "../../src/platform/messaging/background-router";
import { registerConversationHandlers } from "../../src/conversations/background/handlers";

const writeMocks = vi.hoisted(() => ({
  writeConversationMessagesSnapshot: vi.fn(),
  writeConversationSnapshot: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  listConversations: vi.fn(),
  getConversationDetail: vi.fn(),
}));

vi.mock("../../src/conversations/data/write", () => ({
  writeConversationMessagesSnapshot: writeMocks.writeConversationMessagesSnapshot,
  writeConversationSnapshot: writeMocks.writeConversationSnapshot,
}));

vi.mock("../../src/conversations/data/storage", () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  listConversations: storageMocks.listConversations,
  getConversationDetail: storageMocks.getConversationDetail,
}));

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerConversationHandlers(router as any);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  writeMocks.writeConversationMessagesSnapshot.mockReset();
  writeMocks.writeConversationSnapshot.mockReset();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.listConversations.mockReset();
  storageMocks.getConversationDetail.mockReset();
});

describe("background-router conversations events", () => {
  it("broadcasts conversationsChanged after syncConversationMessages", async () => {
    const broadcast = vi.fn();
    writeMocks.writeConversationMessagesSnapshot.mockResolvedValue({ upserted: 1, deleted: 0 });

    const router = createRouter();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: "syncConversationMessages",
      conversationId: 123,
      messages: [],
    });

    expect(res.ok).toBe(true);
    expect(writeMocks.writeConversationMessagesSnapshot).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("conversationsChanged", { reason: "upsert", conversationId: 123 });
  });

  it("broadcasts conversationsChanged after deleteConversations", async () => {
    const broadcast = vi.fn();
    storageMocks.deleteConversationsByIds.mockResolvedValue({
      deletedConversations: 2,
      deletedMessages: 0,
      deletedMappings: 0,
    });

    const router = createRouter();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: "deleteConversations",
      conversationIds: [1, "2", "bad", -1],
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.deleteConversationsByIds).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("conversationsChanged", { reason: "delete", conversationIds: [1, 2] });
  });
});

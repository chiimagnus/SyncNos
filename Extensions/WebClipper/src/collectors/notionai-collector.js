(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function isNotionAiPage() {
    // NotionAI lives under notion.so, but DOM varies; keep permissive for now.
    return /(^|\.)notion\.so$/.test(location.hostname);
  }

  function findConversationRoot() {
    // Placeholder: will be tightened in Task 6 using the Tampermonkey script heuristics.
    // Try common NotionAI chat containers.
    return (
      document.querySelector("[data-testid='notion-ai-chat']") ||
      document.querySelector("[aria-label='Notion AI']") ||
      document.querySelector("div[role='dialog']") ||
      document.body
    );
  }

  function capture() {
    if (!isNotionAiPage()) return null;
    const root = findConversationRoot();
    if (!root) return null;

    const text = root.innerText ? root.innerText.trim() : "";
    if (!text) return null;

    const warningFlags = [];
    if (root === document.body) warningFlags.push("container_low_confidence");

    // Minimal snapshot: treat each paragraph-like block as a message until proper role detection is added.
    const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const messages = parts.slice(0, 200).map((p, i) => ({
      messageKey: NS.normalize.makeFallbackMessageKey({ role: "assistant", contentText: p, sequence: i }),
      role: "assistant",
      contentText: p,
      sequence: i,
      updatedAt: Date.now()
    }));

    if (!messages.length) return null;

    const conversationKey = location.href; // Will be improved for side-panel / floating mode.
    const title = document.title || "NotionAI";

    return {
      conversation: {
        sourceType: "chat",
        source: "notionai",
        conversationKey,
        title,
        url: location.href,
        warningFlags,
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  NS.collectors = NS.collectors || {};
  NS.collectors.notionai = { capture };
})();


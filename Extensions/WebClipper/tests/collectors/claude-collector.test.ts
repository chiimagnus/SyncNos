import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createClaudeCollectorDef } from "../../src/collectors/claude/claude-collector.ts";

function setupClaudeDom(html: string, url: string) {
  return new JSDOM(`<body><main>${html}</main></body>`, { url });
}

describe("claude-collector", () => {
  it("extracts user/assistant and skips thinking blocks", () => {
    const html = `
      <div data-test-render-count="1">
        <div data-testid="user-message">hello</div>
        <div data-testid="assistant-message" class="font-claude-response">
          <div><button aria-expanded="false">toggle</button><span>thinking…</span></div>
          <div>final answer</div>
        </div>
      </div>
    `;
    const dom = setupClaudeDom(html, "https://claude.ai/chat/abc123");

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createClaudeCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);

    const assistant = snap.messages.find((m: any) => m.role === "assistant");
    expect(assistant.contentText).toBe("final answer");
    expect(assistant.contentMarkdown).toBe("final answer");
  });
});


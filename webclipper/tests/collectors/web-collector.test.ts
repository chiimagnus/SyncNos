import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createWebCollectorDef } from "../../src/collectors/web/web-collector.ts";

describe("web-collector", () => {
  it("matches http(s) pages and returns null capture", () => {
    const dom = new JSDOM("<body></body>", { url: "https://example.com/a" });
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const def = createWebCollectorDef(env);
    expect(def.matches({ href: "https://example.com/a" })).toBe(true);
    expect(def.inpageMatches?.({ href: "https://example.com/a" })).toBe(true);
    expect(def.collector.capture()).toBe(null);
  });
});


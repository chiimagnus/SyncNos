import type { CollectorDefinition } from "@collectors/collector-contract.ts";
import type { CollectorEnv } from "@collectors/collector-env.ts";

function isHttpUrl(href: unknown): boolean {
  const raw = String(href || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_e) {
    return false;
  }
}

function matches(loc: { href?: string } | null | undefined): boolean {
  const href = loc && loc.href ? loc.href : "";
  return isHttpUrl(href);
}

export function createWebCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matchesWithEnv(loc: { href?: string } | null | undefined): boolean {
    const href = loc && loc.href ? loc.href : env.location.href;
    return matches({ href });
  }

  const collector = { capture: () => null };
  return { id: "web", matches: matchesWithEnv, inpageMatches: matchesWithEnv, collector };
}

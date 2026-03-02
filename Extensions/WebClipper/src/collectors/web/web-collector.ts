import collectorContext from "../collector-context.ts";

const NS: any = collectorContext as any;

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
  const href = loc && loc.href ? loc.href : location.href;
  return isHttpUrl(href);
}

function capture() {
  return null;
}

const collector = { capture };
NS.collectors = NS.collectors || {};
NS.collectors.web = collector;

if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
  NS.collectorsRegistry.register({
    id: "web",
    matches,
    inpageMatches: matches,
    collector,
  });
}

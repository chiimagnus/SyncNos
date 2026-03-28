import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';

function normalizeHostname(hostname: unknown): string {
  const raw = String(hostname || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  // `location.hostname` never includes a trailing dot, but accept it just in case.
  return raw.endsWith('.') ? raw.slice(0, -1) : raw;
}

function hostMatches(hostname: string, siteHost: string): boolean {
  const host = normalizeHostname(hostname);
  const target = normalizeHostname(siteHost);
  if (!host || !target) return false;
  if (host === target) return true;
  return host.endsWith(`.${target}`);
}

function listDollarMentionSites() {
  return SUPPORTED_AI_CHAT_SITES.filter((site) => site?.features?.dollarMention === true);
}

export function listMentionSupportedHosts(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const site of listDollarMentionSites()) {
    const hosts = Array.isArray(site?.hosts) ? site.hosts : [];
    for (const raw of hosts) {
      const host = normalizeHostname(raw);
      if (!host) continue;
      if (seen.has(host)) continue;
      seen.add(host);
      out.push(host);
    }
  }

  return out;
}

export function pickMentionSupportedSiteIdByHostname(hostname: string): string | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;

  for (const site of listDollarMentionSites()) {
    const hosts = Array.isArray(site?.hosts) ? site.hosts : [];
    for (const siteHost of hosts) {
      if (hostMatches(host, siteHost)) return String(site.id || '').trim() || null;
    }
  }

  return null;
}

export function isMentionSupportedHost(hostname: string): boolean {
  return !!pickMentionSupportedSiteIdByHostname(hostname);
}


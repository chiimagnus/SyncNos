import { storageGet, storageSet } from '@platform/storage/local';

export type AntiHotlinkRule = {
  domain: string;
  referer: string;
};

export type AntiHotlinkRuleValidationIssue = {
  index: number;
  field: 'domain' | 'referer';
  code: 'domain_required' | 'domain_invalid' | 'domain_duplicate' | 'referer_required' | 'referer_invalid';
  message: string;
};

export const ANTI_HOTLINK_RULES_STORAGE_KEY = 'anti_hotlink_rules_v1';

const DEFAULT_RULES_INTERNAL: AntiHotlinkRule[] = [{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }];
const HTTP_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export const DEFAULT_ANTI_HOTLINK_RULES: ReadonlyArray<AntiHotlinkRule> = Object.freeze(
  DEFAULT_RULES_INTERNAL.map((rule) => Object.freeze({ ...rule })),
);

let cachedRules: AntiHotlinkRule[] | null = null;
let loadingPromise: Promise<AntiHotlinkRule[]> | null = null;

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function cloneRules(rules: ReadonlyArray<AntiHotlinkRule>): AntiHotlinkRule[] {
  return rules.map((rule) => ({ domain: rule.domain, referer: rule.referer }));
}

function normalizeDomain(value: unknown): string {
  const raw = safeString(value).toLowerCase();
  if (!raw) return '';
  if (raw.includes('://') || /[\s/?#@]/.test(raw)) return '';

  const trimmedDot = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  if (!trimmedDot) return '';

  const core = trimmedDot.startsWith('[') && trimmedDot.endsWith(']') ? trimmedDot.slice(1, -1) : trimmedDot;
  if (!core) return '';

  // Allow IPv4 and hostnames. The feature is for web domains, so keep validation strict.
  const ipv4Parts = core.split('.');
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((segment) => /^\d{1,3}$/.test(segment) && Number(segment) >= 0 && Number(segment) <= 255);
  if (isIpv4) return core;

  const labels = core.split('.');
  if (labels.length < 2) return '';
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) return '';
    if (label.startsWith('-') || label.endsWith('-')) return '';
  }
  return core;
}

function normalizeReferer(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function parseRuleRow(input: unknown): { domainRaw: string; refererRaw: string } {
  if (!input || typeof input !== 'object') return { domainRaw: '', refererRaw: '' };
  const row = input as Record<string, unknown>;
  return {
    domainRaw: safeString(row.domain),
    refererRaw: safeString(row.referer),
  };
}

export function validateAndNormalizeAntiHotlinkRules(input: unknown): {
  rules: AntiHotlinkRule[];
  issues: AntiHotlinkRuleValidationIssue[];
} {
  const rows = Array.isArray(input) ? input : [];
  const issues: AntiHotlinkRuleValidationIssue[] = [];
  const output: AntiHotlinkRule[] = [];
  const seenDomains = new Set<string>();

  rows.forEach((row, index) => {
    const { domainRaw, refererRaw } = parseRuleRow(row);
    const domain = normalizeDomain(domainRaw);
    const referer = normalizeReferer(refererRaw);

    if (!domainRaw) {
      issues.push({ index, field: 'domain', code: 'domain_required', message: 'Domain is required.' });
    } else if (!domain) {
      issues.push({ index, field: 'domain', code: 'domain_invalid', message: 'Domain must be a valid hostname.' });
    }

    if (!refererRaw) {
      issues.push({ index, field: 'referer', code: 'referer_required', message: 'Referer is required.' });
    } else if (!referer) {
      issues.push({
        index,
        field: 'referer',
        code: 'referer_invalid',
        message: 'Referer must be a valid http(s) URL.',
      });
    }

    if (!domain || !referer) return;
    if (seenDomains.has(domain)) {
      issues.push({
        index,
        field: 'domain',
        code: 'domain_duplicate',
        message: 'Domain must be unique.',
      });
      return;
    }

    seenDomains.add(domain);
    output.push({ domain, referer });
  });

  return { rules: output, issues };
}

export function sanitizeAntiHotlinkRules(input: unknown): AntiHotlinkRule[] {
  const rows = Array.isArray(input) ? input : [];
  const output: AntiHotlinkRule[] = [];
  const seenDomains = new Set<string>();

  for (const row of rows) {
    const { domainRaw, refererRaw } = parseRuleRow(row);
    const domain = normalizeDomain(domainRaw);
    const referer = normalizeReferer(refererRaw);
    if (!domain || !referer || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    output.push({ domain, referer });
  }

  return output;
}

async function loadRulesFromStorage(): Promise<AntiHotlinkRule[]> {
  const local = await storageGet([ANTI_HOTLINK_RULES_STORAGE_KEY]);
  const hasKey = Object.prototype.hasOwnProperty.call(local, ANTI_HOTLINK_RULES_STORAGE_KEY);
  if (!hasKey) {
    const seeded = cloneRules(DEFAULT_ANTI_HOTLINK_RULES);
    await storageSet({ [ANTI_HOTLINK_RULES_STORAGE_KEY]: seeded });
    return seeded;
  }
  return sanitizeAntiHotlinkRules(local[ANTI_HOTLINK_RULES_STORAGE_KEY]);
}

export async function getAntiHotlinkRulesSnapshot(
  options: { forceRefresh?: boolean } = {},
): Promise<AntiHotlinkRule[]> {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cachedRules) {
    return cloneRules(cachedRules);
  }
  if (!forceRefresh && loadingPromise) {
    return cloneRules(await loadingPromise);
  }

  const pending = loadRulesFromStorage()
    .then((rules) => {
      cachedRules = cloneRules(rules);
      return cloneRules(cachedRules);
    })
    .finally(() => {
      loadingPromise = null;
    });
  loadingPromise = pending;

  return cloneRules(await pending);
}

export function invalidateAntiHotlinkRulesCache(): void {
  cachedRules = null;
}

export async function setAntiHotlinkRulesSnapshot(input: ReadonlyArray<AntiHotlinkRule>): Promise<AntiHotlinkRule[]> {
  const normalized = sanitizeAntiHotlinkRules(input);
  await storageSet({ [ANTI_HOTLINK_RULES_STORAGE_KEY]: normalized });
  cachedRules = cloneRules(normalized);
  return cloneRules(normalized);
}

export async function resetAntiHotlinkRulesSnapshot(): Promise<AntiHotlinkRule[]> {
  return await setAntiHotlinkRulesSnapshot(DEFAULT_ANTI_HOTLINK_RULES);
}

export function buildAntiHotlinkRefererMap(rules: ReadonlyArray<AntiHotlinkRule>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule?.domain || !rule?.referer) continue;
    map[rule.domain] = rule.referer;
  }
  return map;
}

function parseHostnameFromHttpUrl(url: unknown): string {
  const raw = safeString(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return normalizeDomain(parsed.hostname);
  } catch (_error) {
    return '';
  }
}

export function getAntiHotlinkRefererFromRules(url: unknown, rules: ReadonlyArray<AntiHotlinkRule>): string | null {
  const hostname = parseHostnameFromHttpUrl(url);
  if (!hostname) return null;
  for (const rule of rules) {
    if (rule.domain === hostname) return rule.referer;
  }
  return null;
}

export async function getAntiHotlinkReferer(
  url: unknown,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const rules = await getAntiHotlinkRulesSnapshot(options);
  return getAntiHotlinkRefererFromRules(url, rules);
}

export function includesAnyAntiHotlinkDomain(text: unknown, rules: ReadonlyArray<AntiHotlinkRule>): boolean {
  const source = String(text ?? '');
  if (!source || !rules.length) return false;

  const domainSet = new Set<string>();
  for (const rule of rules) {
    const domain = normalizeDomain(rule.domain);
    if (!domain) continue;
    domainSet.add(domain);
  }
  if (!domainSet.size) return false;

  HTTP_URL_RE.lastIndex = 0;
  let matched: RegExpExecArray | null = null;
  while ((matched = HTTP_URL_RE.exec(source)) != null) {
    const host = parseHostnameFromHttpUrl(matched[0]);
    if (host && domainSet.has(host)) return true;
  }
  return false;
}

import {
  ANTI_HOTLINK_RULES_STORAGE_KEY,
  DEFAULT_ANTI_HOTLINK_RULES,
  getAntiHotlinkRulesSnapshot,
  resetAntiHotlinkRulesSnapshot,
  setAntiHotlinkRulesSnapshot,
  validateAndNormalizeAntiHotlinkRules,
  type AntiHotlinkRule,
  type AntiHotlinkRuleValidationIssue,
} from '@platform/webext/anti-hotlink-rules-store';

export type AntiHotlinkRuleDraft = {
  domain: string;
  referer: string;
};

export type SaveAntiHotlinkRulesResult =
  | { ok: true; rules: AntiHotlinkRule[] }
  | { ok: false; issues: AntiHotlinkRuleValidationIssue[] };

export const ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY = ANTI_HOTLINK_RULES_STORAGE_KEY;

function toDraftRules(rules: ReadonlyArray<AntiHotlinkRule>): AntiHotlinkRuleDraft[] {
  return rules.map((rule) => ({
    domain: String(rule.domain || ''),
    referer: String(rule.referer || ''),
  }));
}

function toStoredRules(drafts: ReadonlyArray<AntiHotlinkRuleDraft>): Array<{ domain: unknown; referer: unknown }> {
  return (Array.isArray(drafts) ? drafts : []).map((draft) => ({
    domain: draft?.domain,
    referer: draft?.referer,
  }));
}

export async function loadAntiHotlinkRulesForSettings(): Promise<AntiHotlinkRuleDraft[]> {
  const rules = await getAntiHotlinkRulesSnapshot();
  return toDraftRules(rules);
}

export function getDefaultAntiHotlinkRulesForSettings(): AntiHotlinkRuleDraft[] {
  return toDraftRules(DEFAULT_ANTI_HOTLINK_RULES);
}

export async function saveAntiHotlinkRulesForSettings(
  drafts: ReadonlyArray<AntiHotlinkRuleDraft>,
): Promise<SaveAntiHotlinkRulesResult> {
  const { rules, issues } = validateAndNormalizeAntiHotlinkRules(toStoredRules(drafts));
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const saved = await setAntiHotlinkRulesSnapshot(rules);
  return { ok: true, rules: saved };
}

export async function resetAntiHotlinkRulesForSettings(): Promise<AntiHotlinkRuleDraft[]> {
  const resetRules = await resetAntiHotlinkRulesSnapshot();
  return toDraftRules(resetRules);
}

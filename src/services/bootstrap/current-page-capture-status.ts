import { t } from '@i18n';
import type { TranslationKey } from '@i18n/locales/en';

const SOURCE_LABEL_KEYS: Record<string, TranslationKey> = {
  chatgpt: 'sourceChatgpt',
  deepseek: 'sourceDeepseek',
  notionai: 'sourceNotionai',
  gemini: 'sourceGemini',
  googleaistudio: 'sourceGoogleAiStudio',
  kimi: 'sourceKimi',
  doubao: 'sourceDoubao',
  yuanbao: 'sourceYuanbao',
  poe: 'sourcePoe',
  zai: 'sourceZai',
  web: 'sourceWeb',
};

const LIVE_PARTIAL_REASONS = new Set([
  'chatgpt_api_live_tail_unconfirmed',
  'chatgpt_api_live_tail_unresolved',
  'final_live_changed',
]);

const HISTORY_PARTIAL_REASONS = new Set([
  'top_not_reached',
  'bottom_not_reached',
  'boundary_stalled',
  'boundary_unstable',
  'scroll_stalled',
  'step_timeout',
  'step_budget_exhausted',
  'total_deadline_exhausted',
]);

const MEDIA_PARTIAL_REASONS = new Set(['deep_research_hydration_incomplete', 'inline_images_incomplete']);

function normalizeCollectorId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function captureSourceLabel(collectorId: unknown): string {
  const normalized = normalizeCollectorId(collectorId);
  const key = SOURCE_LABEL_KEYS[normalized];
  if (key) return t(key);
  return String(collectorId ?? '').trim();
}

export function buildCaptureWaitingMessage(collectorId: unknown): string {
  const source = captureSourceLabel(collectorId);
  const waiting = t('captureWaitingForMessages');
  return source ? `${source} · ${waiting}` : waiting;
}

export function buildPartialCaptureMessage(reasons: unknown): string {
  const normalized = new Set(
    (Array.isArray(reasons) ? reasons : []).map((reason) => String(reason ?? '').trim()).filter(Boolean),
  );

  if ([...normalized].some((reason) => LIVE_PARTIAL_REASONS.has(reason))) {
    return t('partialCaptureSavedLive');
  }
  if ([...normalized].some((reason) => HISTORY_PARTIAL_REASONS.has(reason))) {
    return t('partialCaptureSavedHistory');
  }
  if ([...normalized].some((reason) => MEDIA_PARTIAL_REASONS.has(reason))) {
    return t('partialCaptureSavedMedia');
  }
  if (normalized.size) return t('partialCaptureSavedContent');
  return t('partialCaptureSaved');
}

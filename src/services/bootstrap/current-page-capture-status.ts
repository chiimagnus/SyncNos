import { t } from '@i18n';
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

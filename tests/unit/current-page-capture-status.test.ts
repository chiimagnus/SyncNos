import { describe, expect, it } from 'vitest';

import { buildPartialCaptureMessage } from '@services/bootstrap/current-page-capture-status';
import { t } from '@i18n';

describe('current-page capture status semantics', () => {
  it('maps live-tail, history, media, and content partial reasons without exposing raw codes', () => {
    expect(buildPartialCaptureMessage(['chatgpt_api_live_tail_unconfirmed'])).toBe(t('partialCaptureSavedLive'));
    expect(buildPartialCaptureMessage(['top_not_reached'])).toBe(t('partialCaptureSavedHistory'));
    expect(buildPartialCaptureMessage(['deep_research_hydration_incomplete'])).toBe(t('partialCaptureSavedMedia'));
    expect(buildPartialCaptureMessage(['chatgpt_api_schema_drift_partial'])).toBe(t('partialCaptureSavedContent'));
    expect(buildPartialCaptureMessage([])).toBe(t('partialCaptureSaved'));
  });
});

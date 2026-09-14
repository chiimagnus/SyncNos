import { describe, expect, it } from 'vitest';

import {
  buildCaptureWaitingMessage,
  buildPartialCaptureMessage,
  captureSourceLabel,
} from '@services/bootstrap/current-page-capture-status';
import { t } from '@i18n';

describe('current-page capture status semantics', () => {
  it('uses localized source names for neutral waiting states', () => {
    expect(captureSourceLabel('chatgpt')).toBe(t('sourceChatgpt'));
    expect(captureSourceLabel('google-ai-studio')).toBe(t('sourceGoogleAiStudio'));
    expect(buildCaptureWaitingMessage('chatgpt')).toBe(`${t('sourceChatgpt')} · ${t('captureWaitingForMessages')}`);
  });

  it('maps live-tail, history, media, and content partial reasons without exposing raw codes', () => {
    expect(buildPartialCaptureMessage(['chatgpt_api_live_tail_unconfirmed'])).toBe(t('partialCaptureSavedLive'));
    expect(buildPartialCaptureMessage(['top_not_reached'])).toBe(t('partialCaptureSavedHistory'));
    expect(buildPartialCaptureMessage(['deep_research_hydration_incomplete'])).toBe(t('partialCaptureSavedMedia'));
    expect(buildPartialCaptureMessage(['chatgpt_api_schema_drift_partial'])).toBe(t('partialCaptureSavedContent'));
    expect(buildPartialCaptureMessage([])).toBe(t('partialCaptureSaved'));
  });
});

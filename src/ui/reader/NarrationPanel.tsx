import { useEffect, useState, type ReactNode } from 'react';
import { SelectMenu } from '@ui/shared/SelectMenu';
import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';
import { textInputClassName } from '@ui/settings/ui';
import { t } from '@i18n';
import {
  READER_TTS_AUDIO_FORMATS,
  READER_TTS_ENGINES,
  type ReaderPrefs,
  type ReaderTtsAudioFormat,
  type ReaderTtsEngineId,
  type ReaderTtsPrefs,
} from '@services/protocols/reader-prefs';

// Presentational, fully controlled. The owning surface (ReaderHeaderToolbar)
// supplies `prefs` and an `update` that persists patches via the reader-prefs
// view-model.
// Narration prefs live under `reader_prefs_v1.tts`; we always pass the full merged
// `tts` object so the patch is type-safe against Partial<ReaderPrefs>.
export type NarrationPanelProps = {
  prefs: ReaderPrefs;
  update: (patch: Partial<ReaderPrefs>) => void | Promise<void>;
  /** Last narration error surfaced from the engine (e.g. AI endpoint failure). */
  error?: string | null;
  /** Whether Web Speech can be used; gates the engine picker + fallback button. */
  webSpeechAvailable?: boolean;
  className?: string;
};

const ENGINE_LABELS: Record<ReaderTtsEngineId, string> = {
  web: t('readerEngineWeb'),
  ai: t('readerEngineAi'),
};
const FORMAT_LABELS: Record<ReaderTtsAudioFormat, string> = {
  opus: t('readerFormatOpus'),
  mp3: t('readerFormatMp3'),
  wav: t('readerFormatWav'),
  aac: t('readerFormatAac'),
  flac: t('readerFormatFlac'),
};

const SPEED_PRESETS = [0.8, 1, 1.25, 1.5, 2] as const;

const fieldInputClassName = [textInputClassName, 'tw-w-full'].join(' ');
const rateButtonBaseClassName = buttonTintClassName();

type WebSpeechLike = {
  getVoices?: () => Array<{ voiceURI: string; name: string }>;
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  onvoiceschanged?: (() => void) | null;
};

function getSpeechSynthesis(): WebSpeechLike | null {
  const scope = globalThis as {
    speechSynthesis?: WebSpeechLike;
  };
  return scope.speechSynthesis ?? null;
}

// Web Speech voices are environment-provided; read defensively because the list
// often starts empty and is populated later via the async `voiceschanged` event.
function listWebVoices(source?: WebSpeechLike | null): Array<{ voiceURI: string; name: string }> {
  const synth = source ?? getSpeechSynthesis();
  try {
    return synth?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <div className="tw-flex tw-items-center tw-justify-between tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
        <span>{label}</span>
        {value ? <span className="tw-tabular-nums tw-text-[var(--text-primary)]">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * NarrationPanel — configures the reader text-to-speech settings stored in
 * `reader_prefs_v1.tts`: engine (Web Speech / AI endpoint), speech rate, the Web
 * voice, and the OpenAI-compatible endpoint fields (endpoint/key/model/voice/format).
 * Fully controlled; all writes go through `update({ tts })` which the view-model
 * re-normalizes (rate clamped, enums validated) before persisting.
 */
export function NarrationPanel({ prefs, update, error, webSpeechAvailable = true, className }: NarrationPanelProps) {
  const tts = prefs.tts;
  const updateTts = (patch: Partial<ReaderTtsPrefs>) => void update({ tts: { ...tts, ...patch } });
  const [webVoices, setWebVoices] = useState<Array<{ voiceURI: string; name: string }>>(() =>
    tts.engine === 'web' ? listWebVoices() : [],
  );

  useEffect(() => {
    if (tts.engine !== 'web') {
      setWebVoices([]);
      return;
    }

    const synth = getSpeechSynthesis();
    const refreshVoices = () => {
      setWebVoices(listWebVoices(synth));
    };
    refreshVoices();
    if (!synth) return;

    if (typeof synth.addEventListener === 'function' && typeof synth.removeEventListener === 'function') {
      synth.addEventListener('voiceschanged', refreshVoices);
      return () => synth.removeEventListener?.('voiceschanged', refreshVoices);
    }

    const previous = synth.onvoiceschanged ?? null;
    const handler = () => {
      previous?.();
      refreshVoices();
    };
    synth.onvoiceschanged = handler;
    return () => {
      if (synth.onvoiceschanged === handler) synth.onvoiceschanged = previous;
    };
  }, [tts.engine]);

  return (
    <div className={['tw-flex tw-flex-col tw-gap-3', className].filter(Boolean).join(' ')}>
      {error ? (
        <div
          role="alert"
          className="tw-flex tw-flex-col tw-gap-2 tw-rounded-[var(--radius-inline)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2 tw-text-xs tw-text-[var(--text-primary)]"
        >
          <span>{error}</span>
          {tts.engine === 'ai' ? (
            <button
              type="button"
              className={buttonTintClassName()}
              disabled={!webSpeechAvailable}
              onClick={() => updateTts({ engine: 'web' })}
            >
              {t('readerNarrationFallback')}
            </button>
          ) : null}
        </div>
      ) : null}

      <Row label={t('readerNarrationEngine')}>
        <SelectMenu<ReaderTtsEngineId>
          ariaLabel={t('readerNarrationEngineAria')}
          value={tts.engine}
          onChange={(next) => updateTts({ engine: next })}
          options={READER_TTS_ENGINES.map((id) => ({
            value: id,
            label: ENGINE_LABELS[id],
            disabled: id === 'web' && !webSpeechAvailable,
          }))}
        />
      </Row>

      <Row label={t('readerNarrationSpeed')}>
        <div className="tw-flex tw-flex-wrap tw-gap-1.5">
          {SPEED_PRESETS.map((rate) => {
            const selected = tts.rate === rate;
            return (
              <button
                key={rate}
                type="button"
                className={selected ? buttonFilledClassName() : rateButtonBaseClassName}
                aria-pressed={selected}
                onClick={() => updateTts({ rate })}
              >
                {String(rate)}x
              </button>
            );
          })}
        </div>
      </Row>

      {tts.engine === 'web' ? (
        <Row label={t('readerNarrationVoice')}>
          <SelectMenu<string>
            ariaLabel={t('readerNarrationVoiceAria')}
            value={tts.webVoiceURI}
            onChange={(next) => updateTts({ webVoiceURI: next })}
            options={[
              { value: '', label: t('readerVoiceSystemDefault') },
              ...webVoices.map((voice) => ({ value: voice.voiceURI, label: voice.name || voice.voiceURI })),
            ]}
          />
        </Row>
      ) : null}

      {tts.engine === 'ai' ? (
        <>
          <Row label={t('readerNarrationEndpoint')}>
            <input
              type="url"
              className={fieldInputClassName}
              aria-label={t('readerNarrationEndpointAria')}
              placeholder="http://localhost:8880/v1"
              value={tts.aiEndpoint}
              onChange={(event) => updateTts({ aiEndpoint: event.target.value })}
            />
          </Row>

          <Row label={t('readerNarrationApiKey')}>
            <input
              type="password"
              className={fieldInputClassName}
              aria-label={t('readerNarrationApiKeyAria')}
              placeholder="sk-..."
              autoComplete="off"
              value={tts.aiApiKey}
              onChange={(event) => updateTts({ aiApiKey: event.target.value })}
            />
          </Row>

          <Row label={t('readerNarrationModel')}>
            <input
              type="text"
              className={fieldInputClassName}
              aria-label={t('readerNarrationModelAria')}
              placeholder="kokoro"
              value={tts.aiModel}
              onChange={(event) => updateTts({ aiModel: event.target.value })}
            />
          </Row>

          <Row label={t('readerNarrationVoice')}>
            <input
              type="text"
              className={fieldInputClassName}
              aria-label={t('readerNarrationAiVoiceAria')}
              placeholder="af_sky"
              value={tts.aiVoice}
              onChange={(event) => updateTts({ aiVoice: event.target.value })}
            />
          </Row>

          <Row label={t('readerNarrationFormat')}>
            <SelectMenu<ReaderTtsAudioFormat>
              ariaLabel={t('readerNarrationFormatAria')}
              value={tts.aiFormat}
              onChange={(next) => updateTts({ aiFormat: next })}
              options={READER_TTS_AUDIO_FORMATS.map((id) => ({ value: id, label: FORMAT_LABELS[id] }))}
            />
          </Row>
        </>
      ) : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import { buttonTintClassName } from '@ui/shared/button-styles';
import { t } from '@i18n';
import { SelectMenu } from '@ui/shared/SelectMenu';
import {
  DEFAULT_READER_TYPOGRAPHY_PRESET,
  READER_FONT_FAMILIES,
  READER_PREFS_LIMITS,
  READER_TEXT_ALIGNS,
  type ReaderFontFamily,
  type ReaderPrefs,
  type ReaderPrefsPatch,
  type ReaderTextAlign,
} from '@services/protocols/reader-prefs';

// Presentational, fully controlled. Discrete actions persist through `update`;
// continuous ranges only `preview` until an explicit interaction boundary commits.
export type TextLayoutPanelProps = {
  prefs: ReaderPrefs;
  update: (patch: ReaderPrefsPatch) => void | Promise<void>;
  preview: (patch: ReaderPrefsPatch) => void;
  commitPreview: () => Promise<void>;
  className?: string;
};

const FONT_FAMILY_LABELS: Record<ReaderFontFamily, string> = {
  serif: t('readerFontSerif'),
  sans: t('readerFontSans'),
  mono: t('readerFontMono'),
};
const TEXT_ALIGN_LABELS: Record<ReaderTextAlign, string> = {
  left: t('readerAlignLeft'),
  justify: t('readerAlignJustify'),
};

// READER_PREFS_LIMITS only exposes min/max; step granularity is a UI concern.
const STEP = { fontSize: 1, lineHeight: 0.05, contentWidth: 10, letterSpacing: 0.005 } as const;

const rangeClassName = [
  'tw-w-full tw-cursor-pointer tw-accent-[var(--accent)]',
  'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
].join(' ');

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
 * TextLayoutPanel — adjusts the reader text-layout fields of `reader_prefs_v1`
 * (font family, size, line height, content width, letter spacing, alignment) and
 * exposes a single reset action that restores the canonical medium/default
 * typography preset. All numeric ranges are bounded by `READER_PREFS_LIMITS`;
 * the model re-clamps on write, so out-of-range values can never reach the CSS
 * variables.
 */
const RANGE_COMMIT_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function TextLayoutPanel({ prefs, update, preview, commitPreview, className }: TextLayoutPanelProps) {
  const commitPreviewBestEffort = () => {
    void commitPreview().catch(() => {});
  };
  const commitOnRangeKeyUp = (key: string) => {
    if (RANGE_COMMIT_KEYS.has(key)) commitPreviewBestEffort();
  };
  return (
    <div className={['tw-flex tw-flex-col tw-gap-3', className].filter(Boolean).join(' ')}>
      <Row label={t('readerTextPreset')}>
        <button
          type="button"
          className={buttonTintClassName()}
          onClick={() => void update({ ...DEFAULT_READER_TYPOGRAPHY_PRESET })}
        >
          {t('reset')}
        </button>
      </Row>

      <Row label={t('readerTextFont')}>
        <SelectMenu<ReaderFontFamily>
          ariaLabel={t('readerFontAria')}
          value={prefs.fontFamily}
          onChange={(next) => void update({ fontFamily: next })}
          options={READER_FONT_FAMILIES.map((id) => ({ value: id, label: FONT_FAMILY_LABELS[id] }))}
        />
      </Row>

      <Row label={t('readerTextAlignment')}>
        <SelectMenu<ReaderTextAlign>
          ariaLabel={t('readerAlignAria')}
          value={prefs.textAlign}
          onChange={(next) => void update({ textAlign: next })}
          options={READER_TEXT_ALIGNS.map((id) => ({ value: id, label: TEXT_ALIGN_LABELS[id] }))}
        />
      </Row>

      <Row label={t('readerTextFontSize')} value={`${prefs.fontSize}px`}>
        <input
          type="range"
          className={rangeClassName}
          aria-label={t('readerFontSizeAria')}
          min={READER_PREFS_LIMITS.fontSize.min}
          max={READER_PREFS_LIMITS.fontSize.max}
          step={STEP.fontSize}
          value={prefs.fontSize}
          onChange={(event) => preview({ fontSize: Number(event.target.value) })}
          onPointerUp={commitPreviewBestEffort}
          onPointerCancel={commitPreviewBestEffort}
          onBlur={commitPreviewBestEffort}
          onKeyUp={(event) => commitOnRangeKeyUp(event.key)}
        />
      </Row>

      <Row label={t('readerTextLineHeight')} value={prefs.lineHeight.toFixed(2)}>
        <input
          type="range"
          className={rangeClassName}
          aria-label={t('readerLineHeightAria')}
          min={READER_PREFS_LIMITS.lineHeight.min}
          max={READER_PREFS_LIMITS.lineHeight.max}
          step={STEP.lineHeight}
          value={prefs.lineHeight}
          onChange={(event) => preview({ lineHeight: Number(event.target.value) })}
          onPointerUp={commitPreviewBestEffort}
          onPointerCancel={commitPreviewBestEffort}
          onBlur={commitPreviewBestEffort}
          onKeyUp={(event) => commitOnRangeKeyUp(event.key)}
        />
      </Row>

      <Row label={t('readerTextContentWidth')} value={`${prefs.contentWidth}px`}>
        <input
          type="range"
          className={rangeClassName}
          aria-label={t('readerContentWidthAria')}
          min={READER_PREFS_LIMITS.contentWidth.min}
          max={READER_PREFS_LIMITS.contentWidth.max}
          step={STEP.contentWidth}
          value={prefs.contentWidth}
          onChange={(event) => preview({ contentWidth: Number(event.target.value) })}
          onPointerUp={commitPreviewBestEffort}
          onPointerCancel={commitPreviewBestEffort}
          onBlur={commitPreviewBestEffort}
          onKeyUp={(event) => commitOnRangeKeyUp(event.key)}
        />
      </Row>

      <Row label={t('readerTextLetterSpacing')} value={`${prefs.letterSpacing.toFixed(3)}em`}>
        <input
          type="range"
          className={rangeClassName}
          aria-label={t('readerLetterSpacingAria')}
          min={READER_PREFS_LIMITS.letterSpacing.min}
          max={READER_PREFS_LIMITS.letterSpacing.max}
          step={STEP.letterSpacing}
          value={prefs.letterSpacing}
          onChange={(event) => preview({ letterSpacing: Number(event.target.value) })}
          onPointerUp={commitPreviewBestEffort}
          onPointerCancel={commitPreviewBestEffort}
          onBlur={commitPreviewBestEffort}
          onKeyUp={(event) => commitOnRangeKeyUp(event.key)}
        />
      </Row>
    </div>
  );
}

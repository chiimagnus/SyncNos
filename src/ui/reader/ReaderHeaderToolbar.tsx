import { useState } from 'react';
import { ChevronRight, Palette, Pause, Play, Square, Type, Volume2 } from 'lucide-react';

import { t } from '@i18n';
import {
  buttonFilledClassName,
  buttonMenuItemClassName,
  buttonTintClassName,
  menuChevronClassName,
} from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { NarrationPanel } from '@ui/reader/NarrationPanel';
import { TextLayoutPanel } from '@ui/reader/TextLayoutPanel';
import { ThemePanel } from '@ui/reader/ThemePanel';
import type { ReaderToolbarFeatures, ReaderToolbarNarration } from '@ui/reader/ReaderToolbar';
import type { ReaderPrefs, ReaderPrefsPatch } from '@services/protocols/reader-prefs';
import type { AppThemeMode } from '@services/protocols/app-theme';

type ReaderHeaderToolbarProps = {
  features: ReaderToolbarFeatures;
  prefs: ReaderPrefs;
  update: (patch: ReaderPrefsPatch) => void | Promise<void>;
  preview: (patch: ReaderPrefsPatch) => void;
  commitPreview: () => Promise<void>;
  themeMode: AppThemeMode;
  updateThemeMode: (mode: AppThemeMode) => void | Promise<void>;
  narration: ReaderToolbarNarration;
  className?: string;
};

type OpenPanel = 'text' | 'theme' | 'narration' | null;

const LABELS = {
  toolbarAria: t('readerToolbarAria'),
  text: t('readerTextLayoutButton'),
  theme: t('readerThemeButton'),
  narration: t('readerNarrationButton'),
  play: t('readerNarrationPlay'),
  reading: t('readerNarrationReading'),
  pause: t('readerNarrationPause'),
  stop: t('readerNarrationStop'),
} as const;

const PANEL_CLASS = 'tw-w-[300px] tw-max-w-[min(300px,calc(100vw-28px))] tw-text-[var(--text-primary)]';
const PANEL_CONTENT_CLASS = 'tw-flex tw-flex-col tw-gap-3';
const readerTriggerClassName = () =>
  [buttonMenuItemClassName(), 'tw-w-full tw-items-center tw-justify-between tw-text-[13px]'].join(' ');
const headerNarrationTransportButtonClassName = (active: boolean) =>
  [active ? buttonFilledClassName() : buttonTintClassName(), 'webclipper-btn--icon'].join(' ');

export function ReaderHeaderToolbar({
  features,
  prefs,
  update,
  preview,
  commitPreview,
  themeMode,
  updateThemeMode,
  narration,
  className,
}: ReaderHeaderToolbarProps) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const transitionPanel = (next: OpenPanel) => {
    if ((openPanel === 'text' || openPanel === 'narration') && next !== openPanel) {
      void commitPreview().catch(() => {});
    }
    setOpenPanel(next);
  };

  if (!features.textLayout && !features.theme && !features.narration) return null;

  const narrationActionLabel =
    narration.state === 'loading' ? LABELS.reading : narration.isPlaying ? LABELS.pause : LABELS.play;
  const NarrationActionIcon = narration.state === 'loading' || narration.isPlaying ? Pause : Play;

  return (
    <div
      role="group"
      aria-label={LABELS.toolbarAria}
      className={['tw-flex tw-flex-col tw-gap-1', className || ''].join(' ').trim()}
      data-reader-header-toolbar="true"
    >
      {features.textLayout ? (
        <MenuPopover
          open={openPanel === 'text'}
          onOpenChange={(next) => transitionPanel(next ? 'text' : null)}
          ariaLabel={LABELS.text}
          side="bottom"
          align="end"
          panelMinWidth={300}
          panelMaxHeight={520}
          panelClassName={PANEL_CLASS}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              data-reader-header-trigger="text"
              aria-label={LABELS.text}
              className={readerTriggerClassName()}
            >
              <span className="tw-inline-flex tw-items-center tw-gap-2">
                <Type size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>{LABELS.text}</span>
              </span>
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={menuChevronClassName()} />
            </button>
          )}
        >
          <div className={PANEL_CONTENT_CLASS}>
            <TextLayoutPanel prefs={prefs} update={update} preview={preview} commitPreview={commitPreview} />
          </div>
        </MenuPopover>
      ) : null}

      {features.theme ? (
        <MenuPopover
          open={openPanel === 'theme'}
          onOpenChange={(next) => transitionPanel(next ? 'theme' : null)}
          ariaLabel={LABELS.theme}
          side="bottom"
          align="end"
          panelMinWidth={300}
          panelMaxHeight={520}
          panelClassName={PANEL_CLASS}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              data-reader-header-trigger="theme"
              aria-label={LABELS.theme}
              className={readerTriggerClassName()}
            >
              <span className="tw-inline-flex tw-items-center tw-gap-2">
                <Palette size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>{LABELS.theme}</span>
              </span>
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={menuChevronClassName()} />
            </button>
          )}
        >
          <div className={PANEL_CONTENT_CLASS}>
            <ThemePanel mode={themeMode} update={updateThemeMode} />
          </div>
        </MenuPopover>
      ) : null}

      {features.narration ? (
        <MenuPopover
          open={openPanel === 'narration'}
          onOpenChange={(next) => transitionPanel(next ? 'narration' : null)}
          ariaLabel={LABELS.narration}
          side="bottom"
          align="end"
          panelMinWidth={300}
          panelMaxHeight={520}
          panelClassName={PANEL_CLASS}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              data-reader-header-trigger="narration"
              aria-label={LABELS.narration}
              className={readerTriggerClassName()}
            >
              <span className="tw-inline-flex tw-items-center tw-gap-2">
                <Volume2 size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>{LABELS.narration}</span>
              </span>
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={menuChevronClassName()} />
            </button>
          )}
        >
          <div className={PANEL_CONTENT_CLASS}>
            <div className="tw-flex tw-gap-1.5">
              <button
                type="button"
                className={headerNarrationTransportButtonClassName(true)}
                aria-label={narrationActionLabel}
                title={narrationActionLabel}
                aria-pressed={narration.isPlaying || narration.state === 'loading'}
                onClick={narration.toggle}
              >
                <NarrationActionIcon size={18} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                className={headerNarrationTransportButtonClassName(false)}
                aria-label={LABELS.stop}
                title={LABELS.stop}
                onClick={narration.stop}
                disabled={narration.state === 'idle'}
              >
                <Square size={18} strokeWidth={2.25} />
              </button>
            </div>
            <NarrationPanel
              prefs={prefs}
              update={update}
              preview={preview}
              commitPreview={commitPreview}
              error={narration.error}
              webSpeechAvailable={narration.webSpeechAvailable}
            />
          </div>
        </MenuPopover>
      ) : null}
    </div>
  );
}

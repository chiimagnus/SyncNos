import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '@i18n';
import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { ArticleOutlineMinimap, type ArticleOutlineMinimapState } from '@ui/reader/ArticleOutlineMinimap';
import type { ReaderOutlineDomEntry } from '@ui/reader/article-outline-dom';
import type { ReaderTtsState } from '@services/reader/tts/reader-tts-engine';

// Structural feature flags are still shared with ReaderHeaderToolbar / ArticleReaderView.
export type ReaderToolbarFeatures = { textLayout: boolean; theme: boolean; narration: boolean };

export type ReaderToolbarNarration = {
  state: ReaderTtsState;
  isPlaying: boolean;
  error: string | null;
  webSpeechAvailable: boolean;
  pause: () => void;
  stop: () => void;
  toggle: () => void;
};

export type ReaderToolbarProps = {
  outline?:
    | (ArticleOutlineMinimapState & {
        onPickStripEntry: (entry: ReaderOutlineDomEntry) => void;
        onPickPanelEntry: (entry: ReaderOutlineDomEntry) => void;
      })
    | null;
  className?: string;
};

const LABELS = {
  toolbarAria: t('readerToolbarAria'),
} as const;

const PANEL_CLOSE_DELAY_MS = 160;

/**
 * ReaderToolbar now owns only the article outline rail.
 *
 * Reader controls (text/theme/narration) live exclusively in ReaderHeaderToolbar.
 * The outline stays beside the article because it is tied to article scroll state.
 */
export function ReaderToolbar({ outline, className }: ReaderToolbarProps) {
  const [openPanel, setOpenPanel] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrow = useIsNarrowScreen({ breakpointPx: 720 });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openNow = useCallback(() => {
    clearCloseTimer();
    setOpenPanel(true);
  }, [clearCloseTimer]);

  const closeNow = useCallback(() => {
    clearCloseTimer();
    setOpenPanel(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpenPanel(false);
    }, PANEL_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  if (!outline?.entries.length) return null;

  const handleOutlinePanelPick = (entry: ReaderOutlineDomEntry) => {
    outline.onPickPanelEntry(entry);
    closeNow();
  };

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={LABELS.toolbarAria}
      className={['webclipper-reader-toolbar tw-flex tw-w-fit tw-flex-col tw-items-start tw-gap-2', className || '']
        .join(' ')
        .trim()}
    >
      <ArticleOutlineMinimap
        entries={outline.entries}
        activeIndex={outline.activeIndex}
        open={openPanel}
        narrow={narrow}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onEscape={closeNow}
        onPickStripEntry={outline.onPickStripEntry}
        onPickPanelEntry={handleOutlinePanelPick}
      />
    </div>
  );
}

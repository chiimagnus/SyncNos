import { t } from '@i18n';
import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { ArticleOutlineMinimap, type ArticleOutlineMinimapState } from '@ui/reader/ArticleOutlineMinimap';
import type { ReaderOutlineDomEntry } from '@ui/reader/article-outline-dom';

type ReaderToolbarProps = {
  outline?:
    | (ArticleOutlineMinimapState & {
        onPickStripEntry: (entry: ReaderOutlineDomEntry) => void;
        onPickPanelEntry: (entry: ReaderOutlineDomEntry) => void;
      })
    | null;
};

/**
 * ReaderToolbar owns the article outline rail. Reader controls
 * (text/theme/narration) live in ReaderHeaderToolbar.
 */
export function ReaderToolbar({ outline }: ReaderToolbarProps) {
  const narrow = useIsNarrowScreen({ breakpointPx: 720 });
  if (!outline?.entries.length) return null;

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('readerToolbarAria')}
      className="webclipper-reader-toolbar tw-flex tw-w-fit tw-flex-col tw-items-start tw-gap-2"
    >
      <ArticleOutlineMinimap
        entries={outline.entries}
        activeIndex={outline.activeIndex}
        narrow={narrow}
        onPickStripEntry={outline.onPickStripEntry}
        onPickPanelEntry={outline.onPickPanelEntry}
      />
    </div>
  );
}

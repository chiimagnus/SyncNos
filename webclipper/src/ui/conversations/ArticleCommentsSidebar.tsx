import { t } from '../../i18n';

import { ArticleCommentsSection } from './ArticleCommentsSection';
import { navIconButtonSmClassName } from '../shared/nav-styles';

export type ArticleCommentsSidebarProps = {
  conversationId: number;
  canonicalUrl: string;
  onClose: () => void;
};

export function ArticleCommentsSidebar({ conversationId, canonicalUrl, onClose }: ArticleCommentsSidebarProps) {
  return (
    <aside
      className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-bg-[var(--bg-sunken)]"
      aria-label={t('articleCommentsHeading')}
    >
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3 tw-py-3">
        <div className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-[13px] tw-font-black tw-tracking-[-0.01em] tw-text-[var(--text-primary)]">
          {t('articleCommentsHeading')}
        </div>

        <button
          type="button"
          onClick={onClose}
          className={navIconButtonSmClassName(false)}
          aria-label={t('closeCommentsSidebar')}
          title={t('closeCommentsSidebar')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6.25 3.25L9.5 6.5L6.25 9.75"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M9.3 6.5H3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
        <ArticleCommentsSection
          conversationId={conversationId}
          canonicalUrl={canonicalUrl}
          containerClassName="tw-px-3 tw-py-3"
          onRequestClose={onClose}
        />
      </div>
    </aside>
  );
}

import { t } from '../../i18n';

import { ArticleCommentsSection } from './ArticleCommentsSection';

export type ArticleCommentsSidebarProps = {
  conversationId: number;
  canonicalUrl: string;
  quoteText?: string;
  focusComposerSignal?: number;
  onClose: () => void;
};

export function ArticleCommentsSidebar({
  conversationId,
  canonicalUrl,
  quoteText,
  focusComposerSignal,
  onClose,
}: ArticleCommentsSidebarProps) {
  return (
    <aside className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-bg-[var(--bg-sunken)]" aria-label={t('articleCommentsHeading')}>
      <ArticleCommentsSection
        conversationId={conversationId}
        canonicalUrl={canonicalUrl}
        quoteText={quoteText}
        focusComposerSignal={focusComposerSignal}
        containerClassName="tw-h-full tw-min-h-0 tw-flex-1"
        onRequestClose={onClose}
      />
    </aside>
  );
}

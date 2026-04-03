import { t } from '@i18n';
import { useEffect } from 'react';

import type { ThreadedCommentsPanelProps } from './types';

export function ThreadedCommentsPanel({
  variant,
  fullWidth,
  showHeader,
  showCollapseButton,
  snapshot,
  onRequestClose,
  onHeaderChatWithRootChange,
}: ThreadedCommentsPanelProps) {
  useEffect(() => {
    return () => {
      onHeaderChatWithRootChange?.(null);
    };
  }, [onHeaderChatWithRootChange]);

  return (
    <div className="webclipper-inpage-comments-panel__surface">
      {showHeader ? (
        <div className="webclipper-inpage-comments-panel__header">
          <div className="webclipper-inpage-comments-panel__header-title">{t('articleCommentsHeading')}</div>
          <div className="webclipper-inpage-comments-panel__header-actions">
            <div
              className="webclipper-inpage-comments-panel__chatwith"
              ref={(el) => {
                onHeaderChatWithRootChange?.(el);
              }}
            />
            {showCollapseButton ? (
              <button
                type="button"
                className="webclipper-inpage-comments-panel__collapse webclipper-btn header-button"
                aria-label={t('closeCommentsSidebar')}
                onClick={() => onRequestClose()}
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
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="webclipper-inpage-comments-panel__body">
        <div
          className="webclipper-inpage-comments-panel__notice"
          style={{ display: snapshot.noticeVisible && snapshot.noticeMessage ? 'block' : 'none' }}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {snapshot.noticeMessage}
        </div>
        <div className="webclipper-inpage-comments-panel__quote" style={{ display: snapshot.quoteText ? 'block' : 'none' }}>
          <div className="webclipper-inpage-comments-panel__quote-text">{snapshot.quoteText}</div>
        </div>
        <div className="webclipper-inpage-comments-panel__composer">
          <div className="webclipper-inpage-comments-panel__avatar">You</div>
          <div className="webclipper-inpage-comments-panel__composer-main">
            <textarea
              className="webclipper-inpage-comments-panel__composer-textarea"
              placeholder="Write a comment…"
              rows={1}
              disabled={false}
            />
            <div className="webclipper-inpage-comments-panel__composer-actions">
              <button
                type="button"
                className="webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--filled webclipper-btn--icon"
                aria-label={t('tooltipCommentSendDetailed')}
                disabled={snapshot.busy}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
        <div className="webclipper-inpage-comments-panel__threads">
          <div className="webclipper-inpage-comments-panel__empty">No comments yet</div>
        </div>
      </div>
      <span style={{ display: 'none' }} data-variant={variant} data-full-width={fullWidth ? '1' : '0'} />
    </div>
  );
}

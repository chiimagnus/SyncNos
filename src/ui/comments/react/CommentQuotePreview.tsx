import { toDisplayCommentQuote } from '@services/comments/locator/comment-quote-policy';
import { buttonIconCircleGhostClassName } from '@ui/shared/button-styles';
import { commentAuthorLabel, formatCommentTime } from './comment-display';

type CommentQuotePreviewProps = {
  text: string;
  variant: 'composer' | 'thread';
  authorName?: string | null;
  createdAt?: number | null;
  invalid?: boolean;
  onClear?: () => void;
  onLocate?: () => void | Promise<void>;
  deleteConfirm?: boolean;
  deleteDisabled?: boolean;
  onDelete?: () => void | Promise<void>;
};

export function CommentQuotePreview({
  text,
  variant,
  authorName,
  createdAt,
  invalid = false,
  onClear,
  onLocate,
  deleteConfirm = false,
  deleteDisabled = false,
  onDelete,
}: CommentQuotePreviewProps) {
  const displayText = toDisplayCommentQuote(text);
  if (!displayText.trim()) return null;
  const className =
    variant === 'composer'
      ? 'webclipper-inpage-comments-panel__quote'
      : 'webclipper-inpage-comments-panel__thread-quote';
  const author = commentAuthorLabel(authorName);
  const time = formatCommentTime(createdAt);
  return (
    <div className={`${className}${invalid ? ' is-invalid' : ''}`} data-locator-invalid={invalid ? '1' : undefined}>
      {variant === 'thread' ? (
        <div className="webclipper-inpage-comments-panel__quote-meta">
          <span className="webclipper-inpage-comments-panel__comment-author">{author}</span>
          {time ? <time className="webclipper-inpage-comments-panel__comment-time">{time}</time> : null}
        </div>
      ) : null}
      <div className="webclipper-inpage-comments-panel__text webclipper-inpage-comments-panel__quote-text">
        {displayText}
      </div>
      {invalid ? <span className="webclipper-inpage-comments-panel__quote-status">Unavailable</span> : null}
      {onLocate || onClear || onDelete ? (
        <div className="webclipper-inpage-comments-panel__quote-actions">
          {onLocate ? (
            <button
              type="button"
              className="webclipper-inpage-comments-panel__quote-locate webclipper-btn webclipper-btn--tone-muted"
              disabled={invalid}
              aria-label="Locate quote"
              onClick={() => void onLocate()}
            >
              Locate
            </button>
          ) : null}
          {onClear ? (
            <button
              type="button"
              className={['webclipper-inpage-comments-panel__quote-clear', buttonIconCircleGhostClassName()].join(' ')}
              aria-label="Clear quote"
              onClick={onClear}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4L12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className={[
                'webclipper-inpage-comments-panel__quote-delete',
                buttonIconCircleGhostClassName(),
                deleteConfirm ? 'webclipper-btn--danger' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-confirm={deleteConfirm ? '1' : undefined}
              disabled={deleteDisabled}
              aria-label={deleteConfirm ? 'Confirm delete comment note' : 'Delete comment note'}
              onClick={() => void onDelete()}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 5H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M6 3.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M5 5L5.5 12.5H10.5L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

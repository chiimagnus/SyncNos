import { toDisplayCommentQuote } from '@services/comments/locator/comment-quote-policy';
import { buttonIconCircleGhostClassName } from '@ui/shared/button-styles';

type CommentQuotePreviewProps = {
  text: string;
  variant: 'composer' | 'thread';
  invalid?: boolean;
  onClear?: () => void;
  onLocate?: () => void | Promise<void>;
};

export function CommentQuotePreview({ text, variant, invalid = false, onClear, onLocate }: CommentQuotePreviewProps) {
  const displayText = toDisplayCommentQuote(text);
  if (!displayText.trim()) return null;
  const className =
    variant === 'composer'
      ? 'webclipper-inpage-comments-panel__quote'
      : 'webclipper-inpage-comments-panel__thread-quote';
  return (
    <div
      className={`${className}${invalid ? ' is-invalid' : ''}`}
      data-variant={variant}
      data-locator-invalid={invalid ? '1' : undefined}
    >
      <div className="webclipper-inpage-comments-panel__text webclipper-inpage-comments-panel__quote-text">
        {displayText}
      </div>
      {invalid ? <span className="webclipper-inpage-comments-panel__quote-status">Unavailable</span> : null}
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
    </div>
  );
}

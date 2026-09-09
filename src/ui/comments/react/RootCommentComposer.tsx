import { t } from '@i18n';
import { useId, type Ref } from 'react';
import { useAutosizeTextarea } from './use-autosize-textarea';
import { isDiscussionSubmitShortcut } from './use-discussion-keyboard';

type RootCommentComposerProps = {
  value: string;
  disabled: boolean;
  canSubmitEmpty?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  textareaRef?: Ref<HTMLTextAreaElement>;
};

function assignRef(ref: Ref<HTMLTextAreaElement> | undefined, node: HTMLTextAreaElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

export function RootCommentComposer({
  value,
  disabled,
  canSubmitEmpty = false,
  onChange,
  onSubmit,
  textareaRef,
}: RootCommentComposerProps) {
  const autosize = useAutosizeTextarea(value);
  const hintId = useId();
  const setTextareaRef = (node: HTMLTextAreaElement | null) => {
    autosize.setRef(node);
    assignRef(textareaRef, node);
  };
  return (
    <div
      className="webclipper-inpage-comments-panel__reply-composer is-root"
      data-webclipper-root-composer="1"
      data-disabled={disabled ? '1' : undefined}
      role="group"
      aria-label="New comment"
      aria-busy={disabled ? 'true' : undefined}
    >
      <div className="webclipper-inpage-comments-panel__composer-field">
        <textarea
          ref={setTextareaRef}
          className="webclipper-inpage-comments-panel__composer-textarea"
          placeholder="Write a comment…"
          aria-label="Write a comment"
          aria-describedby={hintId}
          rows={1}
          value={value}
          onInput={(event) => {
            onChange(event.currentTarget.value);
            autosize.resize();
          }}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            autosize.resize();
          }}
          onKeyDown={(event) => {
            if (isDiscussionSubmitShortcut({ ...event, isComposing: event.nativeEvent.isComposing })) {
              event.preventDefault();
              event.stopPropagation();
              void onSubmit(event.currentTarget.value);
              return;
            }
          }}
          disabled={disabled}
        />
        <div className="webclipper-inpage-comments-panel__composer-toolbar">
          <span id={hintId} className="webclipper-inpage-comments-panel__composer-hint">
            Ctrl/⌘ + Enter to submit
          </span>
          <button
            type="button"
            className="webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--icon"
            aria-label={t('tooltipCommentSendDetailed')}
            disabled={disabled || (!String(value || '').trim() && !canSubmitEmpty)}
            onClick={() => void onSubmit(value)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 8H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path
                d="M8.75 4.25L12.5 8L8.75 11.75"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

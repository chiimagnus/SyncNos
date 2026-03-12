import { useEffect, useRef } from 'react';
import { t } from '../../i18n';

type PopupNotionSyncNudgeDialogProps = {
  open: boolean;
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  onDismiss: () => void;
  onConfirm: () => void;
};

export function PopupNotionSyncNudgeDialog(props: PopupNotionSyncNudgeDialogProps) {
  const { open, dontShowAgain, onDontShowAgainChange, onDismiss, onConfirm } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onDismiss, open]);

  if (!open) return null;

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-[var(--bg-overlay)] tw-p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('popupNotionSyncNudgeAria')}
      onMouseDown={(event) => {
        const target = event.target as Node | null;
        if (target && panelRef.current?.contains(target)) return;
        onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className="tw-w-full tw-max-w-[420px] tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-4 tw-text-[var(--text-primary)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tw-text-sm tw-font-extrabold">{t('popupNotionSyncNudgeTitle')}</div>
        <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
          {t('popupNotionSyncNudgeBody')}
        </div>

        <label className="tw-mt-3 tw-flex tw-cursor-pointer tw-select-none tw-items-start tw-gap-2 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2.5">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => onDontShowAgainChange(event.target.checked)}
            className="tw-mt-0.5 tw-size-4 tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
            aria-label={t('popupNotionSyncNudgeDontShowAria')}
          />
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-primary)]">{t('popupNotionSyncNudgeDontShowLabel')}</span>
        </label>

        <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2">
          <button
            type="button"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text-primary)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-sunken)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
            onClick={onDismiss}
          >
            {t('popupNotionSyncNudgeDismiss')}
          </button>
          <button
            type="button"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-bg-[var(--accent)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--accent-foreground)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--accent-hover)] active:tw-bg-[var(--accent-active)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
            onClick={onConfirm}
          >
            {t('popupNotionSyncNudgeConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

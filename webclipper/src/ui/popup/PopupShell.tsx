import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

import { getURL } from '@services/shared/runtime';
import { openOrFocusExtensionAppTab } from '@services/shared/webext';
import { storageGet, storageSet } from '@services/shared/storage';

import { t } from '@i18n';
import { useConversationsApp, ConversationsProvider } from '@viewmodels/conversations/conversations-context';
import { ConversationsScene, type PopupHeaderState } from '@ui/conversations/ConversationsScene';
import { DetailNavigationHeader } from '@ui/conversations/DetailNavigationHeader';
import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';
import { navIconButtonSmClassName, navPillButtonClassName } from '@ui/shared/nav-styles';
import { usePopupCurrentPageCapture } from '@viewmodels/popup/usePopupCurrentPageCapture';

const POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY = 'webclipper_popup_notion_sync_open_tab_dont_show_v1';

async function getPopupNotionSyncNudgeDismissed(): Promise<boolean> {
  const res = await storageGet([POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]).catch(() => ({}));
  return Boolean((res as any)?.[POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]);
}

async function setPopupNotionSyncNudgeDismissed(next: boolean): Promise<void> {
  await storageSet({ [POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]: Boolean(next) });
}

type PopupNotionSyncNudgeDialogProps = {
  open: boolean;
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  onDismiss: () => void;
  onConfirm: () => void;
};

function PopupNotionSyncNudgeDialog(props: PopupNotionSyncNudgeDialogProps) {
  const { open, dontShowAgain, onDontShowAgainChange, onDismiss, onConfirm } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonClassName = buttonTintClassName();
  const confirmButtonClassName = buttonFilledClassName();

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
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-primary)]">
            {t('popupNotionSyncNudgeDontShowLabel')}
          </span>
        </label>

        <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2">
          <button type="button" className={cancelButtonClassName} onClick={onDismiss}>
            {t('popupNotionSyncNudgeDismiss')}
          </button>
          <button type="button" className={confirmButtonClassName} onClick={onConfirm}>
            {t('popupNotionSyncNudgeConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PopupShell() {
  return (
    <ConversationsProvider>
      <PopupShellFrame />
    </ConversationsProvider>
  );
}

function PopupShellFrame() {
  const [headerState, setHeaderState] = useState<PopupHeaderState>({ mode: 'list' });
  const { refreshList, refreshActiveDetail } = useConversationsApp();
  const [notionSyncNudgeOpen, setNotionSyncNudgeOpen] = useState(false);
  const [notionSyncNudgeDontShowAgain, setNotionSyncNudgeDontShowAgain] = useState(false);
  const { buttonDisabled, buttonLabel, capture, status } = usePopupCurrentPageCapture({
    onCaptured: async () => {
      await refreshList();
      await refreshActiveDetail();
    },
  });

  const onOpenSettings = async () => {
    await openOrFocusExtensionAppTab({ route: '/settings' });
    window.close();
  };

  const onOpenInsightSettings = async () => {
    await openOrFocusExtensionAppTab({ route: '/settings?section=insight' });
    window.close();
  };

  const showListActions = headerState.mode !== 'detail';
  const onPopupNotionSyncStarted = () => {
    void (async () => {
      const dismissed = await getPopupNotionSyncNudgeDismissed().catch(() => false);
      if (dismissed) {
        await openOrFocusExtensionAppTab({ route: '/' });
        window.close();
        return;
      }
      setNotionSyncNudgeDontShowAgain(false);
      setNotionSyncNudgeOpen(true);
    })();
  };

  const persistNudgeIfNeeded = async () => {
    if (!notionSyncNudgeDontShowAgain) return;
    await setPopupNotionSyncNudgeDismissed(true);
  };

  const onConfirmNotionSyncNudge = () => {
    void (async () => {
      setNotionSyncNudgeOpen(false);
      await persistNudgeIfNeeded();
      await openOrFocusExtensionAppTab({ route: '/' });
      window.close();
    })();
  };

  const onDismissNotionSyncNudge = () => {
    void (async () => {
      setNotionSyncNudgeOpen(false);
      await persistNudgeIfNeeded();
    })();
  };

  return (
    <div
      className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]"
      style={{
        fontFamily: '"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",sans-serif',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {showListActions ? (
        <header className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-3 tw-py-2">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
              <img
                className="tw-size-7 tw-rounded-lg tw-object-contain"
                src={getURL('icons/icon-128.png' as any)}
                alt=""
                draggable={false}
              />
              <span className="tw-min-w-0 tw-truncate tw-text-[13px] tw-font-black tw-tracking-[-0.01em]">SyncNos</span>
            </div>

            <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
              <button
                type="button"
                title={buttonDisabled ? status?.message || t('currentPageCannotBeCaptured') : buttonLabel}
                onClick={() => capture().catch(() => {})}
                disabled={buttonDisabled}
                className={navPillButtonClassName()}
                aria-label={buttonLabel}
              >
                <span className="tw-truncate">{buttonLabel}</span>
              </button>

              <button
                type="button"
                title={t('openSettings')}
                onClick={() => onOpenSettings().catch(() => {})}
                className={navIconButtonSmClassName(false)}
                aria-label={t('openSettingsAria')}
              >
                <SettingsIcon size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
      ) : null}

      {!showListActions && headerState.mode === 'detail' ? (
        <header className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3 tw-py-2">
          <DetailNavigationHeader
            title={headerState.title}
            subtitle={headerState.subtitle}
            actions={headerState.actions}
            onBack={headerState.onBack}
          />
        </header>
      ) : null}

      {showListActions && status?.message ? (
        <div
          className={[
            'tw-border-b tw-px-3 tw-py-2 tw-text-[11px] tw-font-semibold',
            status.kind === 'error'
              ? 'tw-border-[var(--error)] tw-bg-[color-mix(in_srgb,var(--error)_14%,var(--bg-card))] tw-text-[var(--error)]'
              : 'tw-border-[var(--success)] tw-bg-[color-mix(in_srgb,var(--success)_14%,var(--bg-card))] tw-text-[var(--success)]',
          ].join(' ')}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </div>
      ) : null}

      <main className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">
        <section id="viewChats" className="tw-h-full tw-min-h-0" aria-label={t('chatsAria')}>
          <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
            <ConversationsScene
              onPopupHeaderStateChange={setHeaderState}
              onPopupNotionSyncStarted={onPopupNotionSyncStarted}
              onOpenInsightsSection={() => {
                void onOpenInsightSettings().catch(() => {});
              }}
            />
          </div>
        </section>
      </main>

      <PopupNotionSyncNudgeDialog
        open={notionSyncNudgeOpen}
        dontShowAgain={notionSyncNudgeDontShowAgain}
        onDontShowAgainChange={setNotionSyncNudgeDontShowAgain}
        onDismiss={onDismissNotionSyncNudge}
        onConfirm={onConfirmNotionSyncNudge}
      />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Settings as SettingsIcon } from 'lucide-react';

import { ensureExtensionAppTab, openOrFocusExtensionAppTab } from '@services/shared/webext';
import { storageGet, storageSet } from '@services/shared/storage';
import { buildConversationRouteFromLoc, encodeConversationLoc } from '@services/shared/conversation-loc';
import { publishPopupSyncSelectionHandoff } from '@services/conversations/popup-sync-selection-handoff';
import type { SyncProvider } from '@services/sync/models';

import { t } from '@i18n';
import { useConversationsApp, ConversationsProvider } from '@viewmodels/conversations/conversations-context';
import { ConversationsScene } from '@ui/conversations/ConversationsScene';
import { buttonFilledClassName, buttonTintClassName, headerButtonClassName } from '@ui/shared/button-styles';
import { AppTooltipHost, tooltipAttrs } from '@ui/shared/AppTooltip';
import { usePopupCurrentPageCapture } from '@viewmodels/popup/usePopupCurrentPageCapture';
import { usePopupOpenCurrentTabInpageCommentsSidebar } from '@viewmodels/popup/usePopupOpenCurrentTabInpageCommentsSidebar';
import { useAppThemeMode } from '@viewmodels/theme/useAppThemeMode';

type PopupSyncNudgeProvider = Extract<SyncProvider, 'notion' | 'feishu'>;

const POPUP_SYNC_NUDGE_DISMISSED_KEYS: Record<PopupSyncNudgeProvider, string> = {
  notion: 'webclipper_popup_notion_sync_open_tab_dont_show_v1',
  feishu: 'webclipper_popup_feishu_sync_open_tab_dont_show_v1',
};

async function getPopupSyncNudgeDismissed(provider: PopupSyncNudgeProvider): Promise<boolean> {
  const key = POPUP_SYNC_NUDGE_DISMISSED_KEYS[provider];
  const stored = await storageGet([key]).catch((): Record<string, unknown> => ({}));
  return Boolean(stored[key]);
}

async function setPopupSyncNudgeDismissed(provider: PopupSyncNudgeProvider): Promise<void> {
  const key = POPUP_SYNC_NUDGE_DISMISSED_KEYS[provider];
  await storageSet({ [key]: true });
}

type PopupSyncNudgeDialogProps = {
  open: boolean;
  ariaLabel: string;
  title: string;
  body: string;
  dontShowAriaLabel: string;
  dontShowLabel: string;
  dismissLabel: string;
  confirmLabel: string;
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  onDismiss: () => void;
  onConfirm: () => void;
};

function PopupSyncNudgeDialog(props: PopupSyncNudgeDialogProps) {
  const {
    open,
    ariaLabel,
    title,
    body,
    dontShowAriaLabel,
    dontShowLabel,
    dismissLabel,
    confirmLabel,
    dontShowAgain,
    onDontShowAgainChange,
    onDismiss,
    onConfirm,
  } = props;
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
      aria-label={ariaLabel}
      onMouseDown={() => onDismiss()}
    >
      <div
        className="tw-w-full tw-max-w-[420px] tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-4 tw-text-[var(--text-primary)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tw-text-sm tw-font-extrabold">{title}</div>
        <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{body}</div>

        <label className="tw-mt-3 tw-flex tw-cursor-pointer tw-select-none tw-items-start tw-gap-2 tw-rounded-[var(--radius-inline)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2.5">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => onDontShowAgainChange(event.target.checked)}
            className="tw-mt-0.5 tw-size-4 tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
            aria-label={dontShowAriaLabel}
          />
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-primary)]">{dontShowLabel}</span>
        </label>

        <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2">
          <button type="button" className={cancelButtonClassName} onClick={onDismiss}>
            {dismissLabel}
          </button>
          <button type="button" className={confirmButtonClassName} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PopupShell() {
  useAppThemeMode();

  return (
    <ConversationsProvider>
      <PopupShellFrame />
      <AppTooltipHost />
    </ConversationsProvider>
  );
}

function PopupShellFrame() {
  const { refreshList, refreshActiveDetail, selectedConversation, selectedIds } = useConversationsApp();
  const [syncNudgeProvider, setSyncNudgeProvider] = useState<PopupSyncNudgeProvider | null>(null);
  const [syncNudgeDontShowAgain, setSyncNudgeDontShowAgain] = useState(false);
  const commentsButton = usePopupOpenCurrentTabInpageCommentsSidebar();
  const { buttonDisabled, buttonLabel, capture, status } = usePopupCurrentPageCapture({
    onCaptured: async () => {
      await refreshList();
      await refreshActiveDetail();
    },
  });

  const onOpenSelectedConversationComments = useCallback(() => {
    void (async () => {
      const convo: any = selectedConversation;
      const source = String(convo?.source || '').trim();
      const conversationKey = String(convo?.conversationKey || '').trim();
      if (!source || !conversationKey) return;

      const loc = encodeConversationLoc({ source, conversationKey });
      const route = buildConversationRouteFromLoc(loc);
      const opened = await openOrFocusExtensionAppTab({ route });
      if (opened) window.close();
    })();
  }, [selectedConversation]);

  const onOpenSettings = useCallback(async () => {
    await openOrFocusExtensionAppTab({ route: '/settings' });
    window.close();
  }, []);

  const onOpenInsightSettings = useCallback(async () => {
    await openOrFocusExtensionAppTab({ route: '/settings?section=aboutyou' });
    window.close();
  }, []);

  const onOpenProviderSettings = useCallback(async (section: string) => {
    const safeSection =
      String(section || '')
        .trim()
        .toLowerCase() || 'notion';
    await openOrFocusExtensionAppTab({ route: `/settings?section=${encodeURIComponent(safeSection)}` });
    window.close();
  }, []);

  const showPopupSyncNudgeIfNeeded = async (provider: PopupSyncNudgeProvider) => {
    if (await getPopupSyncNudgeDismissed(provider)) return;
    setSyncNudgeDontShowAgain(false);
    setSyncNudgeProvider(provider);
  };

  const finishPopupSyncNudge = (openApp: boolean) => {
    const provider = syncNudgeProvider;
    if (!provider) return;
    setSyncNudgeProvider(null);

    void (async () => {
      if (syncNudgeDontShowAgain) {
        await setPopupSyncNudgeDismissed(provider).catch(() => {});
      }
      if (!openApp) return;
      const opened = await openOrFocusExtensionAppTab({ route: '/' });
      if (opened) window.close();
    })().catch(() => {});
  };

  const onPopupSyncPreparing = async (provider: SyncProvider) => {
    await publishPopupSyncSelectionHandoff(selectedIds);
    const appTab = await ensureExtensionAppTab();
    if (!appTab) throw new Error('extension_app_tab_unavailable');
    if (provider === 'notion' || provider === 'feishu') await showPopupSyncNudgeIfNeeded(provider);
  };

  const syncNudgeText =
    syncNudgeProvider === 'feishu'
      ? {
          ariaLabel: t('popupFeishuSyncNudgeAria'),
          body: t('popupFeishuSyncNudgeBody'),
        }
      : {
          ariaLabel: t('popupNotionSyncNudgeAria'),
          body: t('popupNotionSyncNudgeBody'),
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
      <main className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">
        <section id="viewChats" className="tw-h-full tw-min-h-0" aria-label={t('chatsAria')}>
          <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
            <ConversationsScene
              listShell={{
                rightSlot: (
                  <>
                    <span
                      className="tw-inline-flex"
                      {...tooltipAttrs(buttonDisabled ? status?.message || buttonLabel : buttonLabel)}
                    >
                      <button
                        type="button"
                        onClick={() => capture().catch(() => {})}
                        disabled={buttonDisabled}
                        className={[buttonTintClassName(), 'tw-max-w-[168px]'].join(' ')}
                        aria-label={buttonLabel}
                      >
                        <span className="tw-truncate">{buttonLabel}</span>
                      </button>
                    </span>

                    <span className="tw-inline-flex" {...tooltipAttrs(commentsButton.tooltip)}>
                      <button
                        type="button"
                        onClick={() => {
                          void commentsButton.open().then((ok) => {
                            if (ok) window.close();
                          });
                        }}
                        disabled={commentsButton.disabled}
                        className={headerButtonClassName()}
                        aria-label={commentsButton.ariaLabel}
                      >
                        <MessageSquareText size={16} strokeWidth={1.6} aria-hidden="true" />
                      </button>
                    </span>

                    <button
                      type="button"
                      {...tooltipAttrs(t('openSettings'))}
                      onClick={() => onOpenSettings().catch(() => {})}
                      className={headerButtonClassName()}
                      aria-label={t('openSettingsAria')}
                    >
                      <SettingsIcon size={16} strokeWidth={1.6} aria-hidden="true" />
                    </button>
                  </>
                ),
              }}
              onPopupSyncPreparing={onPopupSyncPreparing}
              onOpenInsightsSection={() => {
                void onOpenInsightSettings().catch(() => {});
              }}
              onOpenSettingsSection={(section) => {
                void onOpenProviderSettings(section).catch(() => {});
              }}
              onOpenCommentsExternally={onOpenSelectedConversationComments}
              narrowCommentsOpenSource="popup"
            />
          </div>
        </section>
      </main>

      <PopupSyncNudgeDialog
        open={syncNudgeProvider != null}
        {...syncNudgeText}
        title={t('popupSyncNudgeTitle')}
        dontShowAriaLabel={t('popupSyncNudgeDontShowAria')}
        dontShowLabel={t('popupSyncNudgeDontShowLabel')}
        dismissLabel={t('popupSyncNudgeDismiss')}
        confirmLabel={t('popupSyncNudgeConfirm')}
        dontShowAgain={syncNudgeDontShowAgain}
        onDontShowAgainChange={setSyncNudgeDontShowAgain}
        onDismiss={() => finishPopupSyncNudge(false)}
        onConfirm={() => finishPopupSyncNudge(true)}
      />
    </div>
  );
}

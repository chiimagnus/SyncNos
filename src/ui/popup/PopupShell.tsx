import { useCallback } from 'react';
import { MessageSquareText, Settings as SettingsIcon } from 'lucide-react';

import { ensureExtensionAppTab, openOrFocusExtensionAppTab } from '@services/shared/webext';
import { storageGet, storageSet } from '@services/shared/storage';
import { buildConversationRouteFromLoc, encodeConversationLoc } from '@services/shared/conversation-loc';
import { publishPopupSyncSelectionHandoff } from '@services/conversations/popup-sync-selection-handoff';

import { t } from '@i18n';
import { useConversationsApp, ConversationsProvider } from '@viewmodels/conversations/conversations-context';
import { ConversationsScene } from '@ui/conversations/ConversationsScene';
import { buttonTintClassName, headerButtonClassName } from '@ui/shared/button-styles';
import { AppTooltipHost, tooltipAttrs } from '@ui/shared/AppTooltip';
import { usePopupCurrentPageCapture } from '@viewmodels/popup/usePopupCurrentPageCapture';
import { usePopupOpenCurrentTabInpageCommentsSidebar } from '@viewmodels/popup/usePopupOpenCurrentTabInpageCommentsSidebar';
import { useAppThemeMode } from '@viewmodels/theme/useAppThemeMode';

const POPUP_SYNC_APP_FOREGROUNDED_KEY = 'webclipper_popup_sync_app_foregrounded_v1';

async function ensurePopupSyncAppTab(): Promise<boolean> {
  const stored = await storageGet([POPUP_SYNC_APP_FOREGROUNDED_KEY]).catch(() => ({}));
  const foreground = !(stored as Record<string, unknown>)[POPUP_SYNC_APP_FOREGROUNDED_KEY];
  const tab = await ensureExtensionAppTab({ foreground });
  if (!tab) return false;
  if (foreground) await storageSet({ [POPUP_SYNC_APP_FOREGROUNDED_KEY]: true }).catch(() => {});
  return foreground;
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

  const onPopupSyncStarted = () => {
    void (async () => {
      await publishPopupSyncSelectionHandoff(selectedIds);
      if (await ensurePopupSyncAppTab()) window.close();
    })().catch(() => {});
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
              onPopupSyncStarted={onPopupSyncStarted}
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
    </div>
  );
}

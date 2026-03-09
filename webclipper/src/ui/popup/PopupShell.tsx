import { useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

import { getURL } from '../../platform/runtime/runtime';
import { openOrFocusExtensionAppTab } from '../../platform/webext/extension-app';

import { t } from '../../i18n';
import { useConversationsApp, ConversationsProvider } from '../conversations/conversations-context';
import type { PopupHeaderState } from '../conversations/ConversationsScene';
import { navIconButtonSmClassName, navPillButtonClassName } from '../shared/nav-styles';
import ChatsTab from './tabs/ChatsTab';
import { usePopupCurrentPageCapture } from './usePopupCurrentPageCapture';

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
  const {
    buttonDisabled,
    buttonLabel,
    capture,
    status,
  } = usePopupCurrentPageCapture({
    onCaptured: async () => {
      await refreshList();
      await refreshActiveDetail();
    },
  });

  const onOpenSettings = async () => {
    await openOrFocusExtensionAppTab({ route: '/settings' });
    window.close();
  };

  const showListActions = headerState.mode !== 'detail';

  return (
    <div
      className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg)] tw-text-[var(--text)]"
      style={{
        fontFamily:
          '"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",sans-serif',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {showListActions ? (
        <header className="tw-bg-[var(--panel)]/24 tw-px-3 tw-py-2 tw-backdrop-blur-sm">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
              <img
                className="tw-size-7 tw-rounded-lg tw-object-contain"
                src={getURL('icons/icon-48.png' as any)}
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

      {showListActions && status?.message ? (
        <div
          className={[
            'tw-border-b tw-px-3 tw-py-2 tw-text-[11px] tw-font-semibold',
            status.kind === 'error'
              ? 'tw-border-[#fecaca] tw-bg-[#fef2f2] tw-text-[#b91c1c]'
              : 'tw-border-[#bbf7d0] tw-bg-[#f0fdf4] tw-text-[#166534]',
          ].join(' ')}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </div>
      ) : null}

      <main className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">
        <section id="viewChats" className="tw-h-full tw-min-h-0" aria-label={t('chatsAria')}>
          <ChatsTab onPopupHeaderStateChange={setHeaderState} />
        </section>
      </main>
    </div>
  );
}

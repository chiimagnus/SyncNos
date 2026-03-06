import { Settings as SettingsIcon } from 'lucide-react';

import { getURL } from '../../platform/runtime/runtime';
import { tabsCreate } from '../../platform/webext/tabs';

import ChatsTab from './tabs/ChatsTab';

export default function PopupShell() {
  const onOpenSettings = async () => {
    const url = getURL('/app.html#/settings');
    await tabsCreate({ url });
    window.close();
  };

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
      <header className="tw-border-b tw-border-[var(--border)]/70 tw-bg-[var(--panel)]/70 tw-px-3 tw-py-3 tw-backdrop-blur-md">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <img
              className="tw-size-8 tw-rounded-xl tw-object-contain"
              src={getURL('icons/icon-48.png' as any)}
              alt=""
              draggable={false}
            />
            <span className="tw-min-w-0 tw-truncate tw-text-sm tw-font-black tw-tracking-[-0.01em]">SyncNos</span>
          </div>

          <button
            type="button"
            title="Open Settings"
            onClick={() => onOpenSettings().catch(() => {})}
            className="tw-inline-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
            aria-label="Open Settings"
          >
            <SettingsIcon size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">
        <section id="viewChats" className="tw-h-full tw-min-h-0" aria-label="Chats">
          <ChatsTab />
        </section>
      </main>
    </div>
  );
}

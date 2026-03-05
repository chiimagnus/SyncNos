import { useEffect, useMemo, useState } from 'react';

import { getURL } from '../../platform/runtime/runtime';
import { storageGet, storageSet } from '../../platform/storage/local';
import { tabsCreate } from '../../platform/webext/tabs';

import AboutTab from './tabs/AboutTab';
import ChatsTab from './tabs/ChatsTab';
import SettingsTab from './tabs/SettingsTab';

type PopupTabId = 'chats' | 'settings' | 'about';

export default function PopupShell() {
  const [tab, setTab] = useState<PopupTabId>('chats');

  useEffect(() => {
    storageGet(['popup_active_tab'])
      .then((res) => {
        const v = String(res?.popup_active_tab || '').trim();
        if (v === 'settings' || v === 'about' || v === 'chats') setTab(v);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    storageSet({ popup_active_tab: tab }).catch(() => {});
  }, [tab]);

  const onOpenApp = async () => {
    const url = getURL('/app.html#/');
    await tabsCreate({ url });
    window.close();
  };

  const tabs = useMemo(
    () => [
      { id: 'chats' as const, label: 'Chats' },
      { id: 'settings' as const, label: 'Settings' },
      { id: 'about' as const, label: 'About' },
    ],
    [],
  );

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

          <div className="tw-flex tw-flex-none tw-items-center tw-gap-2">
            <nav
              className="tw-grid tw-w-[216px] tw-shrink-0 tw-select-none tw-grid-cols-3 tw-rounded-full tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 tw-p-1"
              role="tablist"
              aria-label="Popup tabs"
            >
              {tabs.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                    className={[
                      'tw-h-9 tw-rounded-full tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200',
                      active
                        ? 'tw-bg-[var(--btn-bg)] tw-text-[var(--text)] tw-shadow-[0_1px_0_rgba(0,0,0,0.05)]'
                        : 'tw-bg-transparent tw-text-[var(--muted)] hover:tw-text-[var(--text)]',
                    ].join(' ')}
                  >
                    {t.label}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              title="Open App"
              onClick={() => onOpenApp().catch(() => {})}
              className="tw-inline-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[12px] tw-font-black tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
              aria-label="Open App"
            >
              ↗
            </button>
          </div>
        </div>
      </header>

      <main className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">
        {tab === 'chats' ? (
          <section id="viewChats" className="tw-h-full tw-min-h-0" role="tabpanel" aria-label="Chats">
            <ChatsTab />
          </section>
        ) : null}

        {tab === 'settings' ? (
          <section id="viewSettings" className="tw-h-full tw-min-h-0" role="tabpanel" aria-label="Settings">
            <SettingsTab />
          </section>
        ) : null}

        {tab === 'about' ? (
          <section id="viewAbout" className="tw-h-full tw-min-h-0" role="tabpanel" aria-label="About">
            <AboutTab />
          </section>
        ) : null}
      </main>
    </div>
  );
}


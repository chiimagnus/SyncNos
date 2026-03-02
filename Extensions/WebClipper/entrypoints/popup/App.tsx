import '../../src/ui/styles/tailwind.css';
import '../../src/ui/styles/tokens.css';
import './theme.css';

import { useMemo, useState } from 'react';

import AboutTab from './tabs/AboutTab';
import ChatsTab from './tabs/ChatsTab';
import SettingsTab from './tabs/SettingsTab';

export default function App() {
  const [tab, setTab] = useState<'chats' | 'settings' | 'about'>('chats');

  const onOpenApp = async () => {
    const url = browser.runtime.getURL('/app.html#/');
    await browser.tabs.create({ url });
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
    <div className="tw-h-full tw-flex tw-flex-col tw-p-3 tw-gap-3">
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-font-extrabold tw-text-[18px] tw-tracking-[-0.01em]">
          <img
            className="tw-w-5 tw-h-5 tw-rounded-md tw-bg-[var(--panel-strong)] tw-shadow-[0_0_0_2px_rgba(217,89,38,0.12)]"
            src={browser.runtime.getURL('icons/icon-48.png' as any)}
            alt=""
          />
          <span>SyncNos</span>
        </div>

        <button
          className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/50 hover:tw-bg-white/70 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
          onClick={() => onOpenApp().catch(() => {})}
          type="button"
        >
          Open App
        </button>
      </header>

      <nav
        className="tw-grid tw-grid-cols-3 tw-rounded-full tw-border tw-border-[rgba(217,89,38,0.16)] tw-bg-white/55 tw-p-0.5 tw-shadow-[inset_0_0_0_1px_rgba(217,89,38,0.08)]"
        aria-label="Popup tabs"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                'tw-h-7 tw-rounded-full tw-text-[12px] tw-font-semibold tw-transition-colors',
                active ? 'tw-bg-[var(--btn-bg)] tw-text-[var(--text)]' : 'tw-text-[var(--muted)] hover:tw-text-[var(--text)]',
              ].join(' ')}
              aria-selected={active}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <main className="tw-flex-1 tw-min-h-0">
        {tab === 'chats' ? <ChatsTab /> : null}
        {tab === 'settings' ? <SettingsTab /> : null}
        {tab === 'about' ? <AboutTab /> : null}
      </main>
    </div>
  );
}

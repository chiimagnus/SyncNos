import '../../src/ui/styles/tailwind.css';
import '../../src/ui/styles/tokens.css';
import '../../src/ui/styles/flash-ok.css';
import '../../src/ui/styles/popup.css';

import { useEffect, useMemo, useState } from 'react';

import AboutTab from './tabs/AboutTab';
import ChatsTab from './tabs/ChatsTab';
import SettingsTab from './tabs/SettingsTab';
import { storageGet, storageSet } from '../../src/platform/storage/local';

export default function App() {
  const [tab, setTab] = useState<'chats' | 'settings' | 'about'>('chats');

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

  const tabIndex = tab === 'chats' ? 0 : tab === 'settings' ? 1 : 2;

  return (
    <div className="app">
      <header className="header">
        <div className="title">
          <img className="appLogo" src={browser.runtime.getURL('icons/icon-48.png' as any)} alt="" />
          <span>SyncNos</span>
          <button className="sourceOpen" type="button" title="Open App" onClick={() => onOpenApp().catch(() => {})}>
            ↗
          </button>
        </div>

        <nav
          className="tabs tw-select-none"
          role="tablist"
          aria-label="Popup tabs"
          style={{ ['--tab-i' as any]: tabIndex } as any}
        >
          <span className="tabIndicator" aria-hidden="true" />
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                className={['tab', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <section id="viewChats" className={['view', tab === 'chats' ? 'is-active' : ''].filter(Boolean).join(' ')} role="tabpanel">
        <ChatsTab />
      </section>

      <section
        id="viewSettings"
        className={['view', tab === 'settings' ? 'is-active' : ''].filter(Boolean).join(' ')}
        role="tabpanel"
      >
        <SettingsTab />
      </section>

      <section id="viewAbout" className={['view', tab === 'about' ? 'is-active' : ''].filter(Boolean).join(' ')} role="tabpanel">
        <AboutTab />
      </section>
    </div>
  );
}

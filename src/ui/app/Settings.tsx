import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  coerceSettingsSectionKey,
  readStoredSettingsSection,
  type SettingsSectionKey,
  writeStoredSettingsSection,
} from '@viewmodels/settings/types';
import { SettingsScene } from '@ui/settings/SettingsScene';

export default function Settings() {
  const routerLocation = useLocation();
  const navigate = useNavigate();

  type SearchParams = { section: SettingsSectionKey | null; activeSection: SettingsSectionKey; focus: string };

  const params = useMemo<SearchParams>(() => {
    const s = new URLSearchParams(routerLocation.search || '');
    const rawSection = String(s.get('section') || '')
      .trim()
      .toLowerCase();
    const rawFocus = String(s.get('focus') || '')
      .trim()
      .toLowerCase();

    const section = coerceSettingsSectionKey(rawSection);
    return { section, activeSection: section ?? readStoredSettingsSection(), focus: rawFocus };
  }, [routerLocation.search]);

  const activeSection = params.activeSection;
  const focusKey = params.focus;

  const setActiveSection = (key: SettingsSectionKey) => {
    writeStoredSettingsSection(key);
    const next = new URLSearchParams(routerLocation.search || '');
    next.set('section', key);
    next.delete('focus');
    navigate(
      { pathname: routerLocation.pathname, search: `?${next.toString()}` },
      { replace: true, state: routerLocation.state },
    );
  };

  const backToList = () => {
    const next = new URLSearchParams(routerLocation.search || '');
    next.delete('section');
    next.delete('focus');
    navigate(
      { pathname: routerLocation.pathname, search: next.toString() },
      { replace: true, state: routerLocation.state },
    );
  };

  const closeSettings = () => {
    const state: any = (routerLocation as any)?.state ?? {};
    const from = String(state?.from || '').trim();
    if (from) navigate(from, { replace: true });
    else navigate('/', { replace: true });
  };

  return (
    <SettingsScene
      activeSection={activeSection}
      focusKey={focusKey}
      hasExplicitSection={params.section !== null}
      onSelectSection={setActiveSection}
      onBackToList={backToList}
      onClose={closeSettings}
    />
  );
}

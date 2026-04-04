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

  type SearchParams = { section: SettingsSectionKey; focus: string };

  const params = useMemo<SearchParams>(() => {
    const s = new URLSearchParams(routerLocation.search || '');
    const rawSection = String(s.get('section') || '')
      .trim()
      .toLowerCase();
    const rawFocus = String(s.get('focus') || '')
      .trim()
      .toLowerCase();

    // Backward compat: older deep links may use `section=notion-ai`.
    if (rawSection === 'notion-ai') {
      return { section: 'notion', focus: rawFocus || 'notion-ai' };
    }

    const section: SettingsSectionKey = coerceSettingsSectionKey(rawSection) ?? readStoredSettingsSection();
    const focus = rawFocus;
    return { section, focus };
  }, [routerLocation.search]);

  const activeSection = params.section;
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

  return (
    <SettingsScene
      activeSection={activeSection}
      focusKey={focusKey}
      onSelectSection={setActiveSection}
    />
  );
}

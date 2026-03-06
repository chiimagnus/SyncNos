import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { SettingsSectionKey } from '../../settings/types';
import { SettingsScene } from '../../settings/SettingsScene';

export default function Settings() {
  const routerLocation = useLocation();
  const navigate = useNavigate();

  type SearchParams = { section: SettingsSectionKey; focus: string; explicit: boolean };

  const params = useMemo<SearchParams>(() => {
    const s = new URLSearchParams(routerLocation.search || '');
    const rawSection = String(s.get('section') || '').trim().toLowerCase();
    const rawFocus = String(s.get('focus') || '').trim().toLowerCase();
    const explicit = s.has('section') || s.has('focus');

    // Backward compat: older deep links may use `section=notion-ai`.
    if (rawSection === 'notion-ai') {
      return { section: 'notion', focus: rawFocus || 'notion-ai', explicit: true };
    }

    const section: SettingsSectionKey =
      rawSection === 'obsidian' || rawSection === 'backup' || rawSection === 'inpage' || rawSection === 'about'
        ? (rawSection as SettingsSectionKey)
        : 'notion';
    const focus = rawFocus;
    return { section, focus, explicit };
  }, [routerLocation.search]);

  const activeSection = params.section;
  const focusKey = params.focus;

  const setActiveSection = (key: SettingsSectionKey) => {
    const next = new URLSearchParams(routerLocation.search || '');
    next.set('section', key);
    next.delete('focus');
    navigate({ pathname: routerLocation.pathname, search: `?${next.toString()}` }, { replace: true, state: routerLocation.state });
  };

  return (
    <SettingsScene
      activeSection={activeSection}
      focusKey={focusKey}
      onSelectSection={setActiveSection}
      defaultNarrowRoute={params.explicit ? 'detail' : 'list'}
    />
  );
}

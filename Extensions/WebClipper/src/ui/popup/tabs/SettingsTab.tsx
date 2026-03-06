import { useState } from 'react';

import { DEFAULT_SETTINGS_SECTION_KEY, type SettingsSectionKey } from '../../settings/types';
import { SettingsScene } from '../../settings/SettingsScene';

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(DEFAULT_SETTINGS_SECTION_KEY);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <SettingsScene activeSection={activeSection} onSelectSection={setActiveSection} defaultNarrowRoute="list" />
    </div>
  );
}

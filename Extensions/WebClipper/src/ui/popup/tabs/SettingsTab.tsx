import { useState } from 'react';

import { readStoredSettingsSection, type SettingsSectionKey, writeStoredSettingsSection } from '../../settings/types';
import { SettingsScene } from '../../settings/SettingsScene';

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(() => readStoredSettingsSection());

  const handleSelectSection = (key: SettingsSectionKey) => {
    setActiveSection(key);
    writeStoredSettingsSection(key);
  };

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <SettingsScene activeSection={activeSection} onSelectSection={handleSelectSection} defaultNarrowRoute="list" />
    </div>
  );
}

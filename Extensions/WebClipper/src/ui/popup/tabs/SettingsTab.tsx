import { useState } from 'react';

import type { SettingsSectionKey } from '../../app/routes/settings/types';
import { SettingsScene } from '../../settings/SettingsScene';

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>('notion');

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <SettingsScene activeSection={activeSection} onSelectSection={setActiveSection} defaultNarrowRoute="list" />
    </div>
  );
}


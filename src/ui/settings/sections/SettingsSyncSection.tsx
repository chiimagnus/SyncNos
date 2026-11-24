import type { ReactNode } from 'react';
import { t } from '@i18n';
import type { SyncProvider } from '@services/sync/models';
import { SettingsGroup } from './SettingsGroup';
import { SettingsSwitchRow } from './SettingsFormRow';

export function SettingsSyncSection({
  provider,
  busy,
  syncEnabled,
  autoSyncEnabled,
  onToggleSyncEnabled,
  onToggleAutoSyncEnabled,
  children,
}: {
  provider: SyncProvider;
  busy: boolean;
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <>
      <SettingsGroup title={t('settingsSync')}>
        <SettingsSwitchRow
          label={t(`${provider}SyncEnabledLabel`)}
          id={provider + 'SyncEnabledToggle'}
          checked={syncEnabled}
          disabled={busy}
          onChange={onToggleSyncEnabled}
          info={t('settingsSyncInfo')}
        />
        {syncEnabled ? (
          <SettingsSwitchRow
            label={t('settingsAutoSyncLabel')}
            id={provider + 'AutoSyncEnabledToggle'}
            checked={autoSyncEnabled}
            disabled={busy}
            onChange={onToggleAutoSyncEnabled}
            info={t('settingsAutoSyncInfo')}
          />
        ) : null}
      </SettingsGroup>
      {syncEnabled ? children : null}
    </>
  );
}

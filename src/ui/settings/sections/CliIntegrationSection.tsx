import { t } from '@i18n';
import { SettingsGroup } from './SettingsGroup';
import { SettingsExternalLink } from './SettingsExternalLink';
import { SettingsFormRow, SettingsSwitchRow } from './SettingsFormRow';

const SKILL_REPOSITORY_BASE_URL = 'https://github.com/chiimagnus/SyncNos/tree/main/skills';

export function CliIntegrationSection(props: {
  busy: boolean;
  cliIntegrationAvailable: boolean;
  cliIntegrationEnabled: boolean;
  onToggleCliIntegration: (next: boolean) => void;
}) {
  const { busy, cliIntegrationAvailable, cliIntegrationEnabled, onToggleCliIntegration } = props;

  return (
    <>
      <SettingsGroup title={t('settingsLocalAccess')}>
        <SettingsSwitchRow
          label={t('localCliIntegrationLabel')}
          checked={cliIntegrationEnabled}
          disabled={busy || !cliIntegrationAvailable}
          onChange={onToggleCliIntegration}
          description={!cliIntegrationAvailable ? t('localCliIntegrationUnavailable') : undefined}
          info={t('settingsCliInfo')}
          docsPath="cli"
        />
      </SettingsGroup>
      <SettingsGroup title={t('cliSkillHeading')} note={t('cliSkillInstallHint')}>
        <SettingsFormRow label={t('cliSkillChineseLink')}>
          <SettingsExternalLink href={SKILL_REPOSITORY_BASE_URL + '/syncnos-zh'} label={t('cliSkillChineseLink')} />
        </SettingsFormRow>
        <SettingsFormRow label={t('cliSkillEnglishLink')}>
          <SettingsExternalLink href={SKILL_REPOSITORY_BASE_URL + '/syncnos'} label={t('cliSkillEnglishLink')} />
        </SettingsFormRow>
      </SettingsGroup>
    </>
  );
}

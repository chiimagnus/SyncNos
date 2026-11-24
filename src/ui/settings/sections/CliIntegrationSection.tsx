import { t } from '@i18n';
import { SettingsGroup } from './SettingsGroup';
import { SettingsFormRow, SettingsSwitchRow } from './SettingsFormRow';

const SKILL_REPOSITORY_BASE_URL = 'https://github.com/chiimagnus/SyncNos/tree/main/skills';

function SkillLink(props: { href: string; children: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="tw-font-bold tw-text-[var(--accent)] hover:tw-underline focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
    >
      {props.children}
    </a>
  );
}

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
          <SkillLink href={SKILL_REPOSITORY_BASE_URL + '/syncnos-zh'}>{t('settingsOpenLink')}</SkillLink>
        </SettingsFormRow>
        <SettingsFormRow label={t('cliSkillEnglishLink')}>
          <SkillLink href={SKILL_REPOSITORY_BASE_URL + '/syncnos'}>{t('settingsOpenLink')}</SkillLink>
        </SettingsFormRow>
      </SettingsGroup>
    </>
  );
}

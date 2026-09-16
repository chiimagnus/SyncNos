import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import { cardClassName, checkboxClassName } from '@ui/settings/ui';

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
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('localCliIntegrationHeading')}>
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
            {t('localCliIntegrationHeading')}
          </h2>
          <SettingsDocsLink path="cli" />
        </div>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={cliIntegrationEnabled}
            disabled={busy || !cliIntegrationAvailable}
            onChange={(e) => onToggleCliIntegration(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('localCliIntegrationLabel')}
        </label>
        {!cliIntegrationAvailable ? (
          <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('localCliIntegrationUnavailable')}
          </div>
        ) : null}
      </section>

      <section className={cardClassName} aria-label={t('cliSkillHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('cliSkillHeading')}</h2>
        <p className="tw-mb-0 tw-mt-2.5 tw-text-sm tw-font-semibold tw-leading-6 tw-text-[var(--text-secondary)]">
          {t('cliSkillInstallHint')}
        </p>
        <div className="tw-mt-2.5 tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-2 tw-text-sm">
          <SkillLink href={`${SKILL_REPOSITORY_BASE_URL}/syncnos-zh`}>{t('cliSkillChineseLink')}</SkillLink>
          <SkillLink href={`${SKILL_REPOSITORY_BASE_URL}/syncnos`}>{t('cliSkillEnglishLink')}</SkillLink>
        </div>
      </section>
    </div>
  );
}

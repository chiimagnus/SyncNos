import { getManifest, getURL } from '@services/shared/runtime';

import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import { buttonClassName } from '@ui/settings/ui';
import { SettingsFormRow } from './SettingsFormRow';
import { SettingsGroup } from './SettingsGroup';

export function AboutSection() {
  const version = (() => {
    try {
      const manifest = getManifest();
      return String(manifest?.version || '');
    } catch (_e) {
      return '';
    }
  })();

  return (
    <>
      <SettingsGroup title={t('aboutSectionAria')}>
        <SettingsFormRow
          label={
            <span className="settings-account">
              <img src={getURL('icons/icon-128.png' as any) || undefined} alt="" draggable={false} />
              <span>
                SyncNos WebClipper
                <small id="aboutVersion">{version ? t('versionPrefix') + ' ' + version : t('versionPrefix')}</small>
              </span>
            </span>
          }
        >
          <SettingsDocsLink />
        </SettingsFormRow>
        <SettingsFormRow label={t('sourceCode')}>
          <a
            id="linkAboutSource"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos"
            target="_blank"
            rel="noreferrer"
            aria-label={t('sourceCode')}
          >
            {t('settingsOpenLink')}
          </a>
        </SettingsFormRow>
        <SettingsFormRow label={t('changelog')}>
          <a
            id="linkAboutChangelog"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos/releases"
            target="_blank"
            rel="noreferrer"
            aria-label={t('changelog')}
          >
            {t('settingsOpenLink')}
          </a>
        </SettingsFormRow>
        <SettingsFormRow label={t('githubFeedback')}>
          <a
            id="linkAboutGitHub"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos/issues"
            target="_blank"
            rel="noreferrer"
            aria-label={t('githubFeedback')}
          >
            {t('settingsOpenLink')}
          </a>
        </SettingsFormRow>
      </SettingsGroup>
      <SettingsGroup title={t('authorSectionAria')}>
        <SettingsFormRow
          label={
            <span className="settings-account">
              <img
                src={getURL('icons/author-avatar.png' as any) || undefined}
                alt="Chii Magnus avatar"
                draggable={false}
              />
              <span>
                𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼<small>{t('authorTagline')}</small>
              </span>
            </span>
          }
        >
          <span />
        </SettingsFormRow>
        <SettingsFormRow label={t('angelsLinkLabel')} description={t('angelsCta')}>
          <a
            id="linkAboutAngels"
            className={buttonClassName}
            href="https://chiimagnus.github.io/SyncNos/#sponsors"
            target="_blank"
            rel="noreferrer"
            aria-label={t('angelsLinkLabel')}
          >
            {t('settingsOpenLink')}
          </a>
        </SettingsFormRow>
      </SettingsGroup>
      <SettingsGroup title={t('supportHeading')} ariaLabel={t('supportSectionAria')}>
        <div className="tw-py-3">
          <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-leading-6 tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('supportIntro')}
          </p>
          <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-leading-6 tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('supportAskPrefix')}
            <strong className="tw-text-[var(--text-primary)]">{t('supportAskEmphasis')}</strong>
            {t('supportAskSuffix')}
          </p>
          <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-leading-6 tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('supportWhy')}
          </p>

          <img
            className="tw-mt-3 tw-w-full tw-rounded-[var(--radius-inline)] tw-object-cover"
            src={getURL('icons/buymeacoffee1.jpg' as any) || undefined}
            alt={t('donateSectionAria')}
            draggable={false}
          />
        </div>
      </SettingsGroup>
    </>
  );
}

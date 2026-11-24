import { getManifest, getURL } from '@services/shared/runtime';

import { getCurrentLocale, t } from '@i18n';
import { BookOpen, CodeXml, History, MessageSquarePlus, HeartHandshake } from 'lucide-react';
import { buildSettingsDocsUrl } from '@ui/settings/SettingsDocsLink';
import { SettingsExternalLink } from './SettingsExternalLink';
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
          <SettingsExternalLink
            href={buildSettingsDocsUrl(undefined, getCurrentLocale())}
            label={t('settingsDocsLink')}
            icon={BookOpen}
          />
        </SettingsFormRow>
        <SettingsFormRow label={t('sourceCode')}>
          <SettingsExternalLink
            id="linkAboutSource"
            icon={CodeXml}
            href="https://github.com/chiimagnus/SyncNos"
            label={t('sourceCode')}
          />
        </SettingsFormRow>
        <SettingsFormRow label={t('changelog')}>
          <SettingsExternalLink
            id="linkAboutChangelog"
            icon={History}
            href="https://github.com/chiimagnus/SyncNos/releases"
            label={t('changelog')}
          />
        </SettingsFormRow>
        <SettingsFormRow label={t('githubFeedback')}>
          <SettingsExternalLink
            id="linkAboutGitHub"
            icon={MessageSquarePlus}
            href="https://github.com/chiimagnus/SyncNos/issues"
            label={t('githubFeedback')}
          />
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
          <SettingsExternalLink
            id="linkAboutAngels"
            icon={HeartHandshake}
            href="https://chiimagnus.github.io/SyncNos/#sponsors"
            label={t('angelsLinkLabel')}
          />
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

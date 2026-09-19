import { getManifest, getURL } from '@services/shared/runtime';

import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import { buttonClassName, cardClassName } from '@ui/settings/ui';

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
      <section className={cardClassName} aria-label={t('aboutSectionAria')}>
        <div className="tw-flex tw-items-start tw-gap-3">
          <img
            className="tw-size-10 tw-rounded-2xl tw-object-contain"
            src={getURL('icons/icon-128.png' as any) || undefined}
            alt=""
            draggable={false}
          />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-base tw-font-black tw-text-[var(--text-primary)]">SyncNos WebClipper</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]" id="aboutVersion">
              {version ? `${t('versionPrefix')} ${version}` : t('versionPrefix')}
            </div>
          </div>
          <SettingsDocsLink />
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2" aria-label={t('linksAria')}>
          <a
            id="linkAboutSource"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos"
            target="_blank"
            rel="noreferrer"
          >
            {t('sourceCode')}
          </a>
          <a
            id="linkAboutChangelog"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos/releases"
            target="_blank"
            rel="noreferrer"
          >
            {t('changelog')}
          </a>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('authorSectionAria')}>
        <div className="tw-flex tw-items-center tw-gap-3">
          <img
            className="tw-size-10 tw-rounded-2xl tw-object-cover"
            src={getURL('icons/author-avatar.png' as any) || undefined}
            alt="Chii Magnus avatar"
            draggable={false}
          />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('authorTagline')}
            </div>
            <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-break-words">
              {t('angelsCta')}
            </div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
          <a
            id="linkAboutGitHub"
            className={buttonClassName}
            href="https://github.com/chiimagnus/SyncNos/issues"
            target="_blank"
            rel="noreferrer"
          >
            {t('githubFeedback')}
          </a>
          <a
            id="linkAboutAngels"
            className={buttonClassName}
            href="https://chiimagnus.github.io/SyncNos/#sponsors"
            target="_blank"
            rel="noreferrer"
          >
            {t('angelsLinkLabel')}
          </a>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('supportSectionAria')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('supportHeading')}</h2>

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
          className="tw-mt-3 tw-w-full tw-rounded-2xl tw-object-cover"
          src={getURL('icons/buymeacoffee1.jpg' as any) || undefined}
          alt={t('donateSectionAria')}
          draggable={false}
        />
      </section>
    </>
  );
}

import { getManifest, getURL } from '@services/shared/runtime';
import { tabsCreate } from '@services/shared/webext';

import { t } from '../../../i18n';
import { buttonClassName, cardClassName } from '../ui';

export function AboutSection() {
  const version = (() => {
    try {
      const manifest = getManifest();
      return String(manifest?.version || '');
    } catch (_e) {
      return '';
    }
  })();

  const openUrl = async (url: string) => {
    await tabsCreate({ url });
  };

  return (
    <>
      <section className={cardClassName} aria-label={t('aboutSectionAria')}>
        <div className="tw-flex tw-items-center tw-gap-3">
          <img className="tw-size-10 tw-rounded-2xl tw-object-contain" src={getURL('icons/icon-128.png' as any)} alt="" draggable={false} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-base tw-font-black tw-text-[var(--text-primary)]">SyncNos WebClipper</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]" id="aboutVersion">
              {version ? `${t('versionPrefix')} ${version}` : t('versionPrefix')}
            </div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2" aria-label={t('linksAria')}>
          <button
            id="btnAboutMacApp"
            className={buttonClassName}
            type="button"
            onClick={() => openUrl('https://apps.apple.com/app/syncnos/id6755133888').catch(() => {})}
          >
            {t('macApp')}
          </button>
          <button
            id="btnAboutSource"
            className={buttonClassName}
            type="button"
            onClick={() => openUrl('https://github.com/chiimagnus/SyncNos').catch(() => {})}
          >
            {t('sourceCode')}
          </button>
          <button
            id="btnAboutChangelog"
            className={buttonClassName}
            type="button"
            onClick={() => openUrl('https://chiimagnus.notion.site/syncnos-changelog').catch(() => {})}
          >
            {t('changelog')}
          </button>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('authorSectionAria')}>
        <div className="tw-flex tw-items-center tw-gap-3">
          <img className="tw-size-10 tw-rounded-2xl tw-object-cover" src={getURL('icons/author-avatar.png' as any)} alt="Chii Magnus avatar" draggable={false} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('authorTagline')}</div>
            <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-break-words">
              {t('angelsCta')}
            </div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
          <button
            id="btnAboutMail"
            className={buttonClassName}
            type="button"
            onClick={() =>
              openUrl('mailto:chii_magnus@outlook.com?subject=%5BSyncNos%20WebClipper%5D%20Feedback').catch(() => {})
            }
          >
            {t('mail')}
          </button>
          <button
            id="btnAboutGitHub"
            className={buttonClassName}
            type="button"
            onClick={() => openUrl('https://github.com/chiimagnus').catch(() => {})}
          >
            GitHub
          </button>
          <button
            id="btnAboutAngels"
            className={buttonClassName}
            type="button"
            onClick={() => openUrl('https://chiimagnus.notion.site/syncnos-angels').catch(() => {})}
          >
            {t('angelsLinkLabel')}
          </button>
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
          src={getURL('icons/buymeacoffee1.jpg' as any)}
          alt={t('donateSectionAria')}
          draggable={false}
        />
      </section>
    </>
  );
}

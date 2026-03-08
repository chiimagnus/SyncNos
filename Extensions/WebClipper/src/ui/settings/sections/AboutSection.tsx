import { getManifest, getURL } from '../../../platform/runtime/runtime';
import { tabsCreate } from '../../../platform/webext/tabs';

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
          <img className="tw-size-10 tw-rounded-2xl tw-object-contain" src={getURL('icons/icon-48.png' as any)} alt="" draggable={false} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-base tw-font-black tw-text-[var(--text)]">SyncNos WebClipper</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)]" id="aboutVersion">
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
            <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{t('authorTagline')}</div>
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
        </div>
      </section>

      <section className={cardClassName} aria-label={t('donateSectionAria')}>
        <img className="tw-w-full tw-rounded-2xl tw-object-cover" src={getURL('icons/buymeacoffee1.jpg' as any)} alt="Chii Magnus donate QR code" draggable={false} />
      </section>
    </>
  );
}

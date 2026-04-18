import { t } from '@i18n';
import { cardClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function WebArticlesSection() {
  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('articlesSectionHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('articlesSectionHeading')}
        </h2>
        <div className="tw-mt-2.5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('articlesSectionIntro')}
        </div>
      </section>

      <section className={cardClassName} aria-label={t('articlesSectionSupportedHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('articlesSectionSupportedHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('articlesSectionSupportedGeneral')}</li>
          <li>
            {t('articlesSectionSupportedEnhancedPrefix')} <Mono>mp.weixin.qq.com</Mono> / <Mono>discourse</Mono> /{' '}
            <Mono>bilibili.com/opus</Mono>
            {t('articlesSectionSupportedEnhancedSuffix')}
          </li>
        </ul>
      </section>

      <section className={cardClassName} aria-label={t('articlesSectionHowToHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('articlesSectionHowToHeading')}
        </h2>
        <ol className="tw-mt-2.5 tw-list-decimal tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('articlesSectionHowToStep1')}</li>
          <li>
            {t('articlesSectionHowToStep2Prefix')} <Mono>{t('fetchArticle')}</Mono>
            {t('articlesSectionHowToStep2Suffix')}
          </li>
          <li>
            {t('articlesSectionHowToStep3Prefix')} <Mono>{t('contextMenuSaveCurrentPage')}</Mono>
            {t('articlesSectionHowToStep3Suffix')}
          </li>
          <li>{t('articlesSectionHowToStep4')}</li>
        </ol>
      </section>

      <section className={cardClassName} aria-label={t('articlesSectionTroubleshootingHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('articlesSectionTroubleshootingHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('articlesSectionTroubleshootingUnsupported')}</li>
          <li>{t('articlesSectionTroubleshootingDynamic')}</li>
        </ul>
      </section>
    </div>
  );
}


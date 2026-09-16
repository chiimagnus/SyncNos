import { t } from '@i18n';
import { cardClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function WebArticlesSection() {
  return (
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
  );
}

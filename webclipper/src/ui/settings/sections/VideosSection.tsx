import { t } from '@i18n';
import { cardClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function VideosSection() {
  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('videosSectionHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('videosSectionHeading')}
        </h2>
        <div className="tw-mt-2.5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('videosSectionIntro')}
        </div>
      </section>

      <section className={cardClassName} aria-label={t('videosSectionSupportedHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('videosSectionSupportedHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>
            {t('videosSectionSupportedYoutubePrefix')} <Mono>youtube.com/watch</Mono> / <Mono>youtu.be</Mono>
            {t('videosSectionSupportedYoutubeSuffix')}
          </li>
          <li>
            {t('videosSectionSupportedBilibiliPrefix')} <Mono>bilibili.com/video</Mono>
            {t('videosSectionSupportedBilibiliSuffix')}
          </li>
        </ul>
      </section>

      <section className={cardClassName} aria-label={t('videosSectionHowToHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('videosSectionHowToHeading')}
        </h2>
        <ol className="tw-mt-2.5 tw-list-decimal tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('videosSectionHowToStep1')}</li>
          <li>{t('videosSectionHowToStep2')}</li>
          <li>{t('videosSectionHowToStep3')}</li>
          <li>{t('videosSectionHowToStep4')}</li>
        </ol>
      </section>

      <section className={cardClassName} aria-label={t('videosSectionTroubleshootingHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('videosSectionTroubleshootingHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('videosSectionTroubleshootingNoSubtitles')}</li>
          <li>{t('videosSectionTroubleshootingUnsupported')}</li>
        </ul>
      </section>
    </div>
  );
}


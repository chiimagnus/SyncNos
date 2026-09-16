import { t } from '@i18n';
import { cardClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function VideosSection() {
  return (
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
          {t('videosSectionSupportedBilibiliPrefix')} <Mono>bilibili.com/video/BV…</Mono> /{' '}
          <Mono>bilibili.com/list/watchlater?bvid=BV…</Mono>
          {t('videosSectionSupportedBilibiliSuffix')}
        </li>
      </ul>
    </section>
  );
}

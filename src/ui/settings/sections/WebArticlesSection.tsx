import { t } from '@i18n';
import { cardClassName, checkboxClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function WebArticlesSection(props: {
  busy: boolean;
  xiaohongshuCommentsCaptureEnabled: boolean;
  onToggleXiaohongshuCommentsCaptureEnabled: (next: boolean) => void;
}) {
  const { busy, xiaohongshuCommentsCaptureEnabled, onToggleXiaohongshuCommentsCaptureEnabled } = props;

  return (
    <div className="tw-grid tw-gap-4">
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

      <section className={cardClassName} aria-label={t('xiaohongshuCommentsHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('xiaohongshuCommentsHeading')}
        </h2>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={xiaohongshuCommentsCaptureEnabled}
            disabled={busy}
            onChange={(e) => onToggleXiaohongshuCommentsCaptureEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('xiaohongshuCommentsLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('xiaohongshuCommentsHint')}
        </div>
      </section>
    </div>
  );
}

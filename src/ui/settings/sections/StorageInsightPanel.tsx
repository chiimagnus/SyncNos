import { t } from '@i18n';
import { useStorageInsight } from '@viewmodels/settings/useStorageInsight';
import { cardClassName } from '@ui/settings/ui';

function formatBytes(value: number | null): string {
  if (value == null) return t('storageInsightUnavailable');
  if (value === 0) return '0 B';
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  const unit = ['B', 'KiB', 'MiB', 'GiB', 'TiB'][order];
  return `${(value / 1024 ** order).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export function StorageInsightPanel() {
  const { overview, status, error } = useStorageInsight();

  return (
    <section className={cardClassName} aria-label={t('storageInsightHeading')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
        {t('storageInsightHeading')}
      </h2>
      <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageInsightEstimateDisclaimer')}</p>
      <dl className="tw-mt-3 tw-grid tw-gap-3 sm:tw-grid-cols-3">
        <div>
          <dt className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">{t('storageInsightCacheRecords')}</dt>
          <dd className="tw-m-0 tw-mt-1 tw-text-lg tw-font-extrabold">
            {overview ? overview.imageCacheRecords.toLocaleString() : t('storageInsightUnavailable')}
          </dd>
        </div>
        <div>
          <dt className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">{t('storageInsightOriginUsage')}</dt>
          <dd className="tw-m-0 tw-mt-1 tw-text-lg tw-font-extrabold">
            {formatBytes(overview?.originUsageBytes ?? null)}
          </dd>
        </div>
        <div>
          <dt className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">{t('storageInsightQuota')}</dt>
          <dd className="tw-m-0 tw-mt-1 tw-text-lg tw-font-extrabold">
            {formatBytes(overview?.originQuotaBytes ?? null)}
          </dd>
        </div>
      </dl>
      {status === 'loading' ? (
        <p className="tw-mt-2 tw-text-xs tw-text-[var(--text-secondary)]" role="status">
          {t('storageInsightLoading')}
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="tw-mt-2 tw-text-xs tw-text-[var(--error)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

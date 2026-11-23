import { t } from '@i18n';
import { useStorageInsight } from '@viewmodels/settings/useStorageInsight';
import { buttonClassName, cardClassName } from '@ui/settings/ui';

function formatBytes(value: number | null): string {
  if (value == null) return t('storageInsightUnavailable');
  if (value === 0) return '0 B';
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  const unit = ['B', 'KiB', 'MiB', 'GiB', 'TiB'][order];
  return `${(value / 1024 ** order).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export function StorageInsightPanel() {
  const { overview, status, error, scanData, scanStatus, scanProgress, scanError, startScan, cancelScan } =
    useStorageInsight();

  return (
    <section className={cardClassName} aria-label={t('storageInsightHeading')}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('storageInsightHeading')}
        </h2>
        <button type="button" className={buttonClassName} onClick={scanStatus === 'running' ? cancelScan : startScan}>
          {t(scanStatus === 'running' ? 'storageInsightCancelScan' : 'storageInsightScan')}
        </button>
      </div>
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
      {scanStatus === 'running' ? (
        <p role="status" className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
          {t('storageInsightScanning')} {scanProgress?.processed.toLocaleString() ?? 0} /{' '}
          {scanProgress?.total.toLocaleString() ?? '…'}
        </p>
      ) : null}
      {scanStatus === 'stale' ? (
        <p role="status" className="tw-mt-3 tw-text-xs tw-text-[var(--text-secondary)]">
          {t('storageInsightStale')}
        </p>
      ) : null}
      {scanStatus === 'error' ? (
        <p role="alert" className="tw-mt-3 tw-text-xs tw-text-[var(--error)]">
          {scanError}
        </p>
      ) : null}
      {scanData ? (
        <div className="tw-mt-4 tw-border-t tw-border-[var(--border)] tw-pt-3">
          <h3 className="tw-m-0 tw-text-sm tw-font-extrabold">{t('storageInsightDetails')}</h3>
          <dl className="tw-mt-2 tw-grid tw-gap-3 sm:tw-grid-cols-3">
            {(
              [
                ['storageInsightReadable', scanData.readableCount.toLocaleString()],
                ['storageInsightBlobBytes', formatBytes(scanData.bytes)],
                ['storageInsightAnimated', scanData.animatedCount.toLocaleString()],
                ['storageInsightUnknownAnimation', scanData.unknownAnimationCount.toLocaleString()],
                ['storageInsightUnreadable', scanData.unreadableCount.toLocaleString()],
                ['storageInsightOrphan', scanData.orphanCount.toLocaleString()],
                ['storageInsightLegacy', scanData.legacyCount.toLocaleString()],
                ['storageInsightMetadataMismatch', scanData.metadataMismatchCount.toLocaleString()],
                ['storageInsightFormatMismatch', scanData.formatMismatchCount.toLocaleString()],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="tw-text-xs tw-text-[var(--text-secondary)]">{t(label)}</dt>
                <dd className="tw-m-0 tw-font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightFormats')}</h3>
          <ul className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
            {scanData.formats.map(({ format, count, bytes }) => (
              <li key={format} className="tw-flex tw-justify-between tw-gap-3">
                <span>
                  {format.toUpperCase()} · {count.toLocaleString()}
                </span>
                <span>{formatBytes(bytes)}</span>
              </li>
            ))}
          </ul>
          <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightLargestImages')}</h3>
          <ol className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
            {scanData.topImages.map((image) => (
              <li key={image.id} className="tw-flex tw-justify-between tw-gap-3">
                <span className="tw-min-w-0 tw-truncate" title={image.url}>
                  #{image.id} · {image.format.toUpperCase()}
                </span>
                <span>{formatBytes(image.bytes)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

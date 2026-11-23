import { useEffect, useMemo, useState } from 'react';
import { t } from '@i18n';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';
import { buttonClassName } from '@ui/settings/ui';
import { formatStorageSize } from '@ui/settings/format-storage-size';
import { useStorageImageBatch } from '@viewmodels/settings/useStorageImageBatch';

const batchLabels = {
  saved: 'storageImageBatchSucceeded',
  'no-savings': 'storageImageBatchNoSavings',
  skipped: 'storageImageBatchSkipped',
  conflict: 'storageImageBatchConflicts',
  failed: 'storageImageBatchFailed',
} as const;

const issueLabels = {
  'no-savings': 'storageImageIssueNoSavings',
  'unsupported-format': 'storageImageIssueUnsupported',
  'metadata-unsafe': 'storageImageIssueMetadata',
  'mime-mismatch': 'storageImageIssueUnsupported',
  'invalid-source': 'storageImageIssueUnsupported',
  'invalid-image': 'storageImageIssueUnsupported',
  'pixels-changed': 'storageImageIssuePixels',
  'codec-unavailable': 'storageImageIssueBrowser',
  'decode-failed': 'storageImageIssueBrowser',
  'too-large': 'storageImageIssueTooLarge',
  image_optimization_conflict: 'storageImageIssueChanged',
  storage_insight_stale: 'storageImageIssueChanged',
  QuotaExceededError: 'storageImageIssueStorageFull',
  image_optimization_readback_failed: 'storageImageIssueVerify',
} as const;

function imageIssue(reason: string): string {
  const key = issueLabels[reason as keyof typeof issueLabels];
  return key ? t(key) : t('storageImageIssueGeneric');
}

export function ImageOptimizationPanel({ assets, scanValid }: { assets: StorageAssetInfo[]; scanValid: boolean }) {
  const batch = useStorageImageBatch();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showCount, setShowCount] = useState(8);
  const [showResultCount, setShowResultCount] = useState(30);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const batchBusy = batch.status === 'running' || batch.status === 'cancelling';
  const eligible = useMemo(
    () =>
      assets
        .filter(
          (asset) =>
            asset.readable &&
            !asset.orphan &&
            asset.animation === 'static' &&
            (asset.format === 'png' || asset.format === 'jpeg'),
        )
        .sort((a, b) => b.bytes - a.bytes || a.id - b.id),
    [assets],
  );
  const selectedAssets = eligible.filter((asset) => selected.has(asset.id));
  useEffect(() => {
    setSelected(new Set());
    setShowCount(8);
    setShowResultCount(30);
    setConfirmBatch(false);
  }, [assets]);
  const toggleSelection = (id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmBatch(false);
  };

  return (
    <section className="tw-mt-3" aria-label={t('storageImageOptimizeTitle')}>
      <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageImageOptimizeDescription')}</p>
      <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={!scanValid || batchBusy || eligible.length === 0}
          onClick={() => {
            setSelected(new Set(eligible.map((asset) => asset.id)));
            setConfirmBatch(false);
          }}
        >
          {t('storageImageSelectAll')} ({eligible.length.toLocaleString()})
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={batchBusy || selected.size === 0}
          onClick={() => {
            setSelected(new Set());
            setConfirmBatch(false);
          }}
        >
          {t('storageImageClearSelection')}
        </button>
        <span className="tw-text-xs tw-text-[var(--text-secondary)]">
          {t('storageImageSelected')}: {selected.size.toLocaleString()}
        </span>
      </div>
      <ul className="tw-mt-3 tw-grid tw-gap-2">
        {eligible.slice(0, showCount).map((asset) => (
          <li key={asset.id} className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <label className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
              <input
                type="checkbox"
                checked={selected.has(asset.id)}
                disabled={!scanValid || batchBusy}
                onChange={() => toggleSelection(asset.id)}
              />
              <span className="tw-min-w-0 tw-text-xs" title={asset.url}>
                <span className="tw-block tw-truncate tw-font-semibold">
                  {asset.title || asset.url || `#${asset.id}`}
                </span>
                <span className="tw-block tw-text-[var(--text-secondary)]">
                  #{asset.id} · {asset.format.toUpperCase()} · {formatStorageSize(asset.bytes)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {showCount < eligible.length ? (
        <button type="button" className={buttonClassName} onClick={() => setShowCount((count) => count + 16)}>
          {t('storageImageShowMore')}
        </button>
      ) : null}
      {selectedAssets.length > 0 && !batchBusy ? (
        <button type="button" className={buttonClassName} disabled={!scanValid} onClick={() => setConfirmBatch(true)}>
          {t('storageImageBatchReview')} ({selectedAssets.length.toLocaleString()})
        </button>
      ) : null}
      {confirmBatch && !batchBusy ? (
        <div className="tw-mt-3 tw-border-t tw-border-[var(--border)] tw-pt-3">
          <p className="tw-m-0 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageImageBatchWarning')}</p>
          <div className="tw-mt-2 tw-flex tw-gap-2">
            <button
              type="button"
              className={buttonClassName}
              disabled={!scanValid || selectedAssets.length === 0}
              onClick={() => {
                setConfirmBatch(false);
                void batch.start(selectedAssets.map(({ id, conversationId }) => ({ id, conversationId })));
              }}
            >
              {t('storageImageBatchConfirm')}
            </button>
            <button type="button" className={buttonClassName} onClick={() => setConfirmBatch(false)}>
              {t('storageImageBatchDismiss')}
            </button>
          </div>
        </div>
      ) : null}
      {batchBusy ? (
        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2" role="status">
          <span className="tw-text-xs">
            {t('storageImageBatchProcessed')}: {batch.result?.processed ?? 0} / {batch.result?.total ?? selected.size}
          </span>
          <button
            type="button"
            className={buttonClassName}
            disabled={batch.status === 'cancelling'}
            onClick={batch.cancel}
          >
            {t(batch.status === 'cancelling' ? 'storageImageBatchCancelling' : 'storageImageBatchCancel')}
          </button>
        </div>
      ) : null}
      {batch.result ? (
        <div className="tw-mt-3 tw-border-t tw-border-[var(--border)] tw-pt-3">
          <p className="tw-m-0 tw-text-xs tw-font-semibold" role="status">
            {t('storageImageBatchProcessed')}: {batch.result.processed} / {batch.result.total} ·{' '}
            {t('storageImageBatchActualSavings')}: {formatStorageSize(batch.result.bytesSaved)}
          </p>
          <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">
            {t('storageImageBatchSucceeded')}: {batch.result.savedCount} · {t('storageImageBatchNoSavings')}:{' '}
            {batch.result.noSavingsCount} · {t('storageImageBatchSkipped')}: {batch.result.skippedCount} ·{' '}
            {t('storageImageBatchConflicts')}: {batch.result.conflictCount} · {t('storageImageBatchFailed')}:{' '}
            {batch.result.failedCount}
          </p>
          {batch.result.entries.length > 0 ? (
            <details className="tw-mt-3">
              <summary className="tw-cursor-pointer tw-text-xs tw-font-semibold">
                {t('storageImageBatchDetails')} ({batch.result.entries.length})
              </summary>
              <ol className="tw-mt-2 tw-grid tw-gap-2 tw-text-xs">
                {batch.result.entries.slice(0, showResultCount).map((entry) => (
                  <li key={entry.id} className="tw-flex tw-justify-between tw-gap-2">
                    <span title={entry.reason}>
                      #{entry.id} · {t(batchLabels[entry.status])}
                      {entry.reason ? ` · ${imageIssue(entry.reason)}` : ''}
                    </span>
                    <span>{formatStorageSize(entry.bytesSaved)}</span>
                  </li>
                ))}
              </ol>
              {showResultCount < batch.result.entries.length ? (
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => setShowResultCount((value) => value + 30)}
                >
                  {t('storageImageShowMore')}
                </button>
              ) : null}
            </details>
          ) : null}
          {batch.status === 'completed' || batch.status === 'cancelled' ? (
            <p className="tw-mt-2 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageImageRescanNeeded')}</p>
          ) : null}
        </div>
      ) : null}
      {batch.status === 'error' ? (
        <p role="alert" className="tw-mt-2 tw-text-xs tw-text-[var(--error)]">
          {imageIssue(batch.error)}
        </p>
      ) : null}
    </section>
  );
}

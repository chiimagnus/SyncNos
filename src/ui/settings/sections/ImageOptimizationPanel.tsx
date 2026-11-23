import { useEffect, useMemo, useState } from 'react';
import { t } from '@i18n';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';
import {
  useStorageImageOptimization,
  type PreparedImageOptimization,
} from '@viewmodels/settings/useStorageImageOptimization';
import { buttonClassName } from '@ui/settings/ui';
import { useStorageImageBatch } from '@viewmodels/settings/useStorageImageBatch';

function PreviewImages({ prepared }: { prepared: PreparedImageOptimization }) {
  const [src, setSrc] = useState<{ original: string; optimized: string } | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const original = URL.createObjectURL(prepared.result.originalBlob);
    const optimized = URL.createObjectURL(prepared.result.optimizedBlob);
    setSrc({ original, optimized });
    return () => {
      URL.revokeObjectURL(original);
      URL.revokeObjectURL(optimized);
    };
  }, [prepared]);
  if (!src) return null;
  return (
    <div className="tw-mt-3 tw-grid tw-gap-3 sm:tw-grid-cols-2">
      <figure className="tw-m-0 tw-min-w-0">
        <img src={src.original} alt={t('storageImageOriginal')} className="tw-w-full tw-max-h-48 tw-object-contain" />
        <figcaption className="tw-mt-1 tw-text-xs">{t('storageImageOriginal')}</figcaption>
      </figure>
      <figure className="tw-m-0 tw-min-w-0">
        <img src={src.optimized} alt={t('storageImageOptimized')} className="tw-w-full tw-max-h-48 tw-object-contain" />
        <figcaption className="tw-mt-1 tw-text-xs">{t('storageImageOptimized')}</figcaption>
      </figure>
    </div>
  );
}

export function ImageOptimizationPanel({ assets, scanValid }: { assets: StorageAssetInfo[]; scanValid: boolean }) {
  const {
    preview,
    previewStatus,
    previewError,
    preparePreview,
    cancelPreview,
    savePreview,
    saveStatus,
    saveError,
    savedBytes,
  } = useStorageImageOptimization(scanValid);
  const [acceptLossy, setAcceptLossy] = useState(false);
  const batch = useStorageImageBatch();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showCount, setShowCount] = useState(24);
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
    setShowCount(24);
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
  useEffect(() => {
    setAcceptLossy(false);
  }, [preview]);

  return (
    <section
      className="tw-mt-4 tw-border-t tw-border-[var(--border)] tw-pt-3"
      aria-label={t('storageImageOptimizeTitle')}
    >
      <h3 className="tw-m-0 tw-text-sm tw-font-extrabold">{t('storageImageOptimizeTitle')}</h3>
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
              <span className="tw-min-w-0 tw-truncate tw-text-xs">
                #{asset.id} · {asset.format.toUpperCase()} · {asset.bytes.toLocaleString()} B
              </span>
            </label>
            <span className="tw-flex tw-flex-wrap tw-gap-2">
              <button
                type="button"
                className={buttonClassName}
                disabled={!scanValid || previewStatus === 'loading' || saveStatus === 'saving' || batchBusy}
                onClick={() =>
                  void preparePreview({ id: asset.id, conversationId: asset.conversationId }, 'pixel-exact')
                }
              >
                {t('storageImagePreviewPixel')}
              </button>
              {asset.format === 'jpeg' ? (
                <button
                  type="button"
                  className={buttonClassName}
                  disabled={!scanValid || previewStatus === 'loading' || saveStatus === 'saving' || batchBusy}
                  onClick={() =>
                    void preparePreview({ id: asset.id, conversationId: asset.conversationId }, 'lossy-preview')
                  }
                >
                  {t('storageImagePreviewLossy')}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {showCount < eligible.length ? (
        <button type="button" className={buttonClassName} onClick={() => setShowCount((count) => count + 24)}>
          {t('storageImageShowMore')}
        </button>
      ) : null}
      {selectedAssets.length > 0 && !batchBusy ? (
        <button
          type="button"
          className={buttonClassName}
          disabled={!scanValid || saveStatus === 'saving'}
          onClick={() => setConfirmBatch(true)}
        >
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
              disabled={!scanValid || selectedAssets.length === 0 || saveStatus === 'saving'}
              onClick={() => {
                setConfirmBatch(false);
                cancelPreview();
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
            {t('storageImageBatchActualSavings')}: {batch.result.bytesSaved.toLocaleString()} B
          </p>
          <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">
            {t('storageImageBatchSucceeded')}: {batch.result.savedCount} · {t('storageImageBatchNoSavings')}:{' '}
            {batch.result.noSavingsCount} · {t('storageImageBatchSkipped')}: {batch.result.skippedCount} ·{' '}
            {t('storageImageBatchConflicts')}: {batch.result.conflictCount} · {t('storageImageBatchFailed')}:{' '}
            {batch.result.failedCount}
          </p>
          <ol className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
            {batch.result.entries.slice(0, showResultCount).map((entry) => (
              <li key={entry.id} className="tw-flex tw-justify-between tw-gap-2">
                <span>
                  #{entry.id} · {entry.status}
                  {entry.reason ? ` (${entry.reason})` : ''}
                </span>
                <span>{entry.bytesSaved.toLocaleString()} B</span>
              </li>
            ))}
          </ol>
          {showResultCount < batch.result.entries.length ? (
            <button type="button" className={buttonClassName} onClick={() => setShowResultCount((value) => value + 30)}>
              {t('storageImageShowMore')}
            </button>
          ) : null}
          {batch.status === 'completed' || batch.status === 'cancelled' ? (
            <p className="tw-mt-2 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageImageRescanNeeded')}</p>
          ) : null}
        </div>
      ) : null}
      {batch.status === 'error' ? (
        <p role="alert" className="tw-mt-2 tw-text-xs tw-text-[var(--error)]">
          {batch.error}
        </p>
      ) : null}
      {previewStatus === 'loading' ? (
        <p className="tw-mt-3 tw-text-xs" role="status">
          {t('storageImagePreviewLoading')}
        </p>
      ) : null}
      {previewStatus === 'unavailable' || previewStatus === 'error' ? (
        <p className="tw-mt-3 tw-text-xs tw-text-[var(--error)]" role="status">
          {t('storageImagePreviewUnavailable')} ({previewError})
        </p>
      ) : null}
      {saveStatus === 'saved' ? (
        <p className="tw-mt-3 tw-text-xs" role="status">
          {t('storageImageSaved')}: {savedBytes.toLocaleString()} B · {t('storageImageRescanNeeded')}
        </p>
      ) : null}
      {saveStatus === 'error' ? (
        <p className="tw-mt-3 tw-text-xs tw-text-[var(--error)]" role="alert">
          {t('storageImageSaveFailed')} ({saveError}). {t('storageImageRescanNeeded')}
        </p>
      ) : null}
      {preview ? (
        <section className="tw-mt-3 tw-border-t tw-border-[var(--border)] tw-pt-3">
          <div className="tw-flex tw-justify-between tw-gap-2">
            <h4 className="tw-m-0 tw-text-sm tw-font-bold">
              #{preview.selection.id} · {t('storageImagePreviewResult')}
            </h4>
            <button
              type="button"
              className={buttonClassName}
              disabled={saveStatus === 'saving'}
              onClick={cancelPreview}
            >
              {t('storageImageClosePreview')}
            </button>
          </div>
          <p className="tw-mt-2 tw-text-xs">
            {preview.result.originalBytes.toLocaleString()} B → {preview.result.optimizedBytes.toLocaleString()} B ·{' '}
            {t('storageImageSavings')}: {preview.result.savedBytes.toLocaleString()} B · {preview.result.width}×
            {preview.result.height}
          </p>
          <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">
            {t(preview.result.mode === 'pixel-exact' ? 'storageImagePixelExactWarning' : 'storageImageLossyWarning')}
          </p>
          <PreviewImages prepared={preview} />
          {preview.result.mode === 'lossy-preview' ? (
            <label className="tw-mt-3 tw-flex tw-items-start tw-gap-2 tw-text-xs">
              <input type="checkbox" checked={acceptLossy} onChange={(event) => setAcceptLossy(event.target.checked)} />
              <span>{t('storageImageConfirmLossy')}</span>
            </label>
          ) : null}
          <div className="tw-mt-3">
            <button
              type="button"
              className={buttonClassName}
              disabled={
                !scanValid ||
                saveStatus === 'saving' ||
                saveStatus === 'error' ||
                (preview.result.mode === 'lossy-preview' && !acceptLossy)
              }
              onClick={() => void savePreview(acceptLossy)}
            >
              {t(saveStatus === 'saving' ? 'storageImageSaving' : 'storageImageSave')}
            </button>
          </div>
          <p className="tw-mt-2 tw-text-xs tw-text-[var(--text-secondary)]">{t('storageImageSaveWarning')}</p>
        </section>
      ) : null}
    </section>
  );
}

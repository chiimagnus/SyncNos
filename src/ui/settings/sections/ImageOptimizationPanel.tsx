import { useEffect, useState } from 'react';
import { t } from '@i18n';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';
import {
  useStorageImageOptimization,
  type PreparedImageOptimization,
} from '@viewmodels/settings/useStorageImageOptimization';
import { buttonClassName } from '@ui/settings/ui';

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
      <ul className="tw-mt-3 tw-grid tw-gap-2">
        {assets
          .filter(
            (asset) =>
              asset.readable &&
              !asset.orphan &&
              asset.animation === 'static' &&
              (asset.format === 'png' || asset.format === 'jpeg'),
          )
          .map((asset) => (
            <li key={asset.id} className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
              <span className="tw-min-w-0 tw-truncate tw-text-xs">
                #{asset.id} · {asset.format.toUpperCase()} · {asset.bytes.toLocaleString()} B
              </span>
              <span className="tw-flex tw-flex-wrap tw-gap-2">
                <button
                  type="button"
                  className={buttonClassName}
                  disabled={!scanValid || previewStatus === 'loading' || saveStatus === 'saving'}
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
                    disabled={!scanValid || previewStatus === 'loading' || saveStatus === 'saving'}
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

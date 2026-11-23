import { useState } from 'react';
import type { ConversationMessage } from '@services/conversations/domain/models';
import { useConversationStorage } from '@viewmodels/conversations/useConversationStorage';
import { t } from '@i18n';
import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

export function DetailStorageSection({
  conversationId,
  messages,
}: {
  conversationId: number;
  messages: readonly ConversationMessage[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [visible, setVisible] = useState(6);
  const { status, details, error, refresh, optimization, optimize, cancel } = useConversationStorage({
    conversationId,
    messages,
  });
  const images = details?.images ?? [];
  const candidates = images.filter((item) => item.optimizable);
  const busy = optimization.status === 'running';

  if (status === 'loading' || (status === 'ready' && images.length === 0)) return null;
  if (status === 'error') {
    return (
      <div data-detail-storage="true" className="tw-mt-1 tw-flex tw-items-center tw-gap-2 tw-text-[11px]">
        <span>{t('detailStorageLoadFailed')}</span>
        <button type="button" className={buttonTintClassName()} onClick={refresh} title={error}>
          {t('detailStorageRetry')}
        </button>
      </div>
    );
  }
  if (!details) return null;

  return (
    <div data-detail-storage="true" className="tw-mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="detail-storage-breakdown"
        className="tw-inline-flex tw-items-center tw-flex-wrap tw-gap-1 tw-border-0 tw-bg-transparent tw-p-0 tw-pt-1 tw-text-left tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)] hover:tw-underline focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--focus-ring)]"
        onClick={() => {
          setExpanded((value) => !value);
          setConfirming(false);
        }}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {t('detailStorageLocalImages')} {formatSize(details.imageBytes)}
        <span>· {t(expanded ? 'detailStorageHide' : 'detailStorageShow')}</span>
      </button>
      {expanded ? (
        <div id="detail-storage-breakdown" className="tw-mt-2 tw-border-t tw-border-[var(--border)] tw-pt-1">
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {images.slice(0, visible).map((image) => (
              <li
                key={image.id}
                className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-[var(--border)] tw-py-1.5 tw-text-[11px]"
              >
                <span title={image.label} className="tw-min-w-0 tw-flex-1 tw-truncate">
                  {image.label}
                </span>
                <span className="tw-shrink-0 tw-text-[var(--text-secondary)]">
                  {image.format} · {formatSize(image.bytes)}
                </span>
              </li>
            ))}
          </ul>
          {visible < images.length ? (
            <button
              type="button"
              className="tw-mt-2 tw-border-0 tw-bg-transparent tw-p-0 tw-text-[11px] tw-text-[var(--text-secondary)] hover:tw-underline focus-visible:tw-outline"
              onClick={() => setVisible((value) => value + 8)}
            >
              {t('detailStorageMore')} ({images.length - visible})
            </button>
          ) : null}
          {candidates.length > 0 && !busy && optimization.status !== 'done' ? (
            <button
              type="button"
              className={`${buttonTintClassName()} tw-mt-2 tw-w-full tw-justify-center tw-text-[11px]`}
              onClick={() => setConfirming(true)}
            >
              {t('detailStorageOptimize')} ({candidates.length})
            </button>
          ) : null}
          {confirming && !busy ? (
            <div className="tw-mt-2 tw-rounded-[var(--radius-inline)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-2">
              <p className="tw-m-0 tw-text-[11px] tw-leading-relaxed">{t('detailStorageConfirmHint')}</p>
              <div className="tw-mt-2 tw-flex tw-gap-2">
                <button
                  type="button"
                  className={buttonFilledClassName()}
                  onClick={() => {
                    setConfirming(false);
                    void optimize();
                  }}
                >
                  {t('detailStorageConfirm')}
                </button>
                <button type="button" className={buttonTintClassName()} onClick={() => setConfirming(false)}>
                  {t('cancelButton')}
                </button>
              </div>
            </div>
          ) : null}
          {busy ? (
            <div className="tw-mt-2 tw-flex tw-items-center tw-justify-between tw-gap-2" role="status">
              <span>
                {t('detailStorageOptimizing')} {optimization.progress?.processed ?? 0}/
                {optimization.progress?.total ?? candidates.length}
              </span>
              <button type="button" className={buttonTintClassName()} onClick={cancel}>
                {t('detailStorageStop')}
              </button>
            </div>
          ) : null}
          {optimization.status === 'done' && optimization.progress ? (
            <p className="tw-mt-2 tw-text-[11px] tw-leading-relaxed tw-text-[var(--text-primary)]" role="status">
              {optimization.progress.cancelled ? t('detailStorageStopped') : t('detailStorageFinished')}
              {' · '}
              {t('detailStorageFreed')} {formatSize(optimization.progress.bytesSaved)}
              {' · '}
              {t('detailStorageSaved')} {optimization.progress.optimized}
            </p>
          ) : null}
          {optimization.status === 'error' ? (
            <p className="tw-mt-2 tw-text-[11px] tw-text-[var(--error)]" role="alert" title={optimization.error}>
              {t('detailStorageOptimizeFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

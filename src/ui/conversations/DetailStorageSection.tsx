import { useState } from 'react';
import type { ConversationMessage } from '@services/conversations/domain/models';
import { useConversationStorage } from '@viewmodels/conversations/useConversationStorage';
import { t } from '@i18n';
import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
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
  const candidates = details?.images.filter((item) => item.optimizable) || [];
  const total = details?.totalBytes ?? null;
  const percentText = details && total ? (details.textBytes / total) * 100 : 100;
  const busy = optimization.status === 'running';

  return (
    <div data-detail-storage="true" className="tw-mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="detail-storage-breakdown"
        className="tw-inline-flex tw-items-center tw-flex-wrap tw-gap-1 tw-border-0 tw-bg-transparent tw-p-0 tw-pt-1 tw-text-left tw-text-[11px] tw-font-bold tw-text-[var(--text-primary)] hover:tw-underline focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--focus-ring)]"
        onClick={() => {
          setExpanded((value) => !value);
          setConfirming(false);
        }}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {t('detailStorageTotal')}
        <span className="tw-font-extrabold">
          {status === 'ready' ? formatSize(total) : status === 'error' ? '—' : t('detailStorageLoading')}
        </span>
        <span>· {t(expanded ? 'detailStorageHide' : 'detailStorageShow')}</span>
      </button>
      {expanded ? (
        <div id="detail-storage-breakdown" className="tw-mt-2 tw-border-t tw-border-[var(--border)] tw-pt-2">
          {status === 'loading' ? (
            <p role="status" className="tw-my-1">
              {t('detailStorageLoading')}
            </p>
          ) : status === 'error' || !details ? (
            <div>
              <p role="alert" className="tw-my-1">
                {t('detailStorageLoadFailed')}
              </p>
              <button type="button" className={buttonTintClassName()} onClick={refresh} title={error}>
                {t('detailStorageRetry')}
              </button>
            </div>
          ) : (
            <>
              <div className="tw-flex tw-items-baseline tw-justify-between tw-gap-2 tw-text-[11px]">
                <strong className="tw-text-[var(--text-primary)]">{t('detailStorageHeading')}</strong>
                <strong className="tw-text-sm tw-text-[var(--text-primary)]">{formatSize(total)}</strong>
              </div>
              <div
                className="tw-mt-2 tw-flex tw-h-1.5 tw-w-full tw-overflow-hidden tw-rounded-[var(--radius-inline)] tw-bg-[var(--border)]"
                aria-hidden="true"
              >
                <span
                  style={{ width: `${percentText}%` }}
                  className="tw-bg-[color-mix(in_srgb,var(--text-secondary)_55%,var(--bg-card))]"
                />
                <span style={{ width: `${100 - percentText}%` }} className="tw-bg-[var(--accent)]" />
              </div>
              <div className="tw-mt-2 tw-flex tw-flex-wrap tw-justify-between tw-gap-x-2 tw-gap-y-1 tw-text-[11px] tw-text-[var(--text-secondary)]">
                <span>
                  <span aria-hidden="true" className="tw-mr-1">
                    ●
                  </span>
                  {t('detailStorageText')} {formatSize(details.textBytes)}
                </span>
                <span>
                  <span aria-hidden="true" className="tw-mr-1 tw-text-[var(--accent-foreground)]">
                    ●
                  </span>
                  {t('detailStorageImages')} {formatSize(details.imageBytes)}
                </span>
              </div>
              <div className="tw-mt-3 tw-text-[11px] tw-font-bold tw-text-[var(--text-primary)]">
                {details.images.length
                  ? `${t('detailStorageResources')}（${details.images.length}）`
                  : t('detailStorageNoImages')}
              </div>
              {details.images.length ? (
                <>
                  <ul className="tw-m-0 tw-mt-1 tw-list-none tw-p-0">
                    {details.images.slice(0, visible).map((image) => (
                      <li
                        key={image.id}
                        className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-[var(--border)] tw-py-1.5 tw-text-[11px]"
                      >
                        <span title={image.label} className="tw-min-w-0 tw-flex-1 tw-truncate">
                          {image.label}
                        </span>
                        <span
                          className={
                            image.state === 'missing'
                              ? 'tw-shrink-0 tw-text-[var(--error)]'
                              : 'tw-shrink-0 tw-text-[var(--text-secondary)]'
                          }
                        >
                          {image.state === 'missing'
                            ? t('detailStorageMissing')
                            : `${image.format} · ${formatSize(image.bytes)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {visible < details.images.length ? (
                    <button
                      type="button"
                      className="tw-mt-2 tw-bg-transparent tw-border-0 tw-p-0 tw-text-xs tw-text-[var(--text-secondary)] hover:tw-underline focus-visible:tw-outline"
                      onClick={() => setVisible((value) => value + 8)}
                    >
                      {t('detailStorageMore')} ({details.images.length - visible})
                    </button>
                  ) : null}
                </>
              ) : null}
              {details.otherReferences || details.missingReferences ? (
                <p className="tw-mt-2 tw-text-[10px] tw-leading-relaxed tw-text-[var(--text-secondary)]">
                  {details.missingReferences ? `${t('detailStorageBrokenRefs')} ${details.missingReferences} · ` : ''}
                  {t('detailStorageRemoteRefs')} {details.otherReferences}
                </p>
              ) : null}
              <p className="tw-mt-2 tw-text-[10px] tw-leading-relaxed tw-text-[var(--text-secondary)]">
                {t('detailStorageEstimateHint')}
              </p>
              {details.images.length > 0 && !busy && optimization.status !== 'done' ? (
                <button
                  type="button"
                  className={`${buttonTintClassName()} tw-mt-2 tw-w-full tw-justify-center tw-text-[11px]`}
                  disabled={candidates.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  {candidates.length
                    ? `${t('detailStorageOptimize')} · ${candidates.length} ${t('detailStorageCandidates')}`
                    : t('detailStorageNoneOptimizable')}
                </button>
              ) : null}
              {confirming && !busy ? (
                <div className="tw-mt-2 tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-2 tw-rounded-[var(--radius-inline)]">
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
                  {t('detailStorageChecked')} {optimization.progress.processed}
                  {' · '}
                  {t('detailStorageSaved')} {optimization.progress.optimized}
                  {' · '}
                  {t('detailStorageFreed')} {formatSize(optimization.progress.bytesSaved)}
                </p>
              ) : null}
              {optimization.status === 'error' ? (
                <p className="tw-mt-2 tw-text-[11px] tw-text-[var(--error)]" role="alert" title={optimization.error}>
                  {t('detailStorageOptimizeFailed')}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

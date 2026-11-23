import { Link } from 'react-router-dom';
import { t } from '@i18n';
import { buildConversationRouteFromLoc, decodeConversationLoc } from '@services/shared/conversation-loc';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { openConversation as openConversationInApp } from '@ui/conversations/open-conversation';
import { setPendingOpenConversationId } from '@ui/conversations/pending-open';
import { useStorageInsight } from '@viewmodels/settings/useStorageInsight';
import { ImageOptimizationPanel } from '@ui/settings/sections/ImageOptimizationPanel';
import { buttonClassName, cardClassName, conversationJumpLinkClassName } from '@ui/settings/ui';

function formatBytes(value: number | null): string {
  if (value == null) return t('storageInsightUnavailable');
  if (value === 0) return '0 B';
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  const unit = ['B', 'KiB', 'MiB', 'GiB', 'TiB'][order];
  return `${(value / 1024 ** order).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function StorageConversationLink(props: { conversationId: number; title: string; source: string; loc: string }) {
  const { openConversationInListScopeByLoc, openConversationInListScopeById } = useConversationsApp();
  const isNarrow = useIsNarrowScreen();
  const { conversationId, title, loc } = props;
  const identity = decodeConversationLoc(loc);
  if (!loc) return <span>{title}</span>;
  return (
    <Link
      to={buildConversationRouteFromLoc(loc)}
      replace
      className={conversationJumpLinkClassName}
      title={title}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        const openedId = openConversationInApp(conversationId, {
          isNarrow,
          setActiveId: (id) => {
            if (identity) void openConversationInListScopeByLoc(identity);
            else void openConversationInListScopeById(Number(id));
          },
        });
        if (isNarrow && openedId && identity) setPendingOpenConversationId(openedId, identity);
      }}
    >
      {title}
    </Link>
  );
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
          {t(
            scanProgress?.phase === 'messages'
              ? 'storageInsightScanningMessages'
              : scanProgress?.phase === 'comments'
                ? 'storageInsightScanningComments'
                : 'storageInsightScanning',
          )}{' '}
          {scanProgress?.processed.toLocaleString() ?? 0} / {scanProgress?.total.toLocaleString() ?? '…'}
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
          {scanData.content ? (
            <div className="tw-mt-4 tw-border-t tw-border-[var(--border)] tw-pt-3">
              <h3 className="tw-m-0 tw-text-sm tw-font-extrabold">{t('storageInsightReferences')}</h3>
              <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">
                {t('storageInsightReferenceDisclaimer')}
              </p>
              <dl className="tw-mt-2 tw-grid tw-gap-3 sm:tw-grid-cols-3">
                {(
                  [
                    ['storageInsightLogicalText', formatBytes(scanData.content.logicalTextBytes)],
                    ['storageInsightCommentBytes', formatBytes(scanData.content.commentBytes)],
                    ['storageInsightOrphanComments', formatBytes(scanData.content.orphanCommentBytes)],
                    ['storageInsightImageOccurrences', scanData.content.imageOccurrences.toLocaleString()],
                    ['storageInsightUniqueTargets', scanData.content.uniqueImageTargets.toLocaleString()],
                    ['storageInsightUniqueLocalIds', scanData.content.uniqueLocalAssetIds.toLocaleString()],
                    ['storageInsightValidLocal', scanData.content.availableLocalOccurrences.toLocaleString()],
                    ['storageInsightBrokenLocal', scanData.content.brokenLocalOccurrences.toLocaleString()],
                    ['storageInsightOtherImages', scanData.content.otherImageOccurrences.toLocaleString()],
                    ['storageInsightUnreferenced', scanData.content.unreferencedCacheRecords.toLocaleString()],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="tw-text-xs tw-text-[var(--text-secondary)]">{t(label)}</dt>
                    <dd className="tw-m-0 tw-font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightContentByKind')}</h3>
              <ul className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
                {scanData.content.byKind.map(({ kind, bytes }) => (
                  <li key={kind} className="tw-flex tw-justify-between tw-gap-3">
                    <span>{kind}</span>
                    <span>{formatBytes(bytes)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightTopSources')}</h3>
              <ul className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
                {scanData.content.topSources.slice(0, 8).map(({ source, bytes }) => (
                  <li key={source} className="tw-flex tw-justify-between tw-gap-3">
                    <span>{source}</span>
                    <span>{formatBytes(bytes)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightTopConversations')}</h3>
              <ol className="tw-mt-2 tw-grid tw-gap-2 tw-text-xs">
                {scanData.content.topConversations.map((entry) => (
                  <li key={entry.conversationId} className="tw-flex tw-items-center tw-justify-between tw-gap-3">
                    <span className="tw-min-w-0 tw-truncate">
                      {entry.loc ? <StorageConversationLink {...entry} /> : entry.title}
                    </span>
                    <span className="tw-shrink-0">{formatBytes(entry.bytes)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <h3 className="tw-m-0 tw-mt-4 tw-text-sm tw-font-extrabold">{t('storageInsightLargestImages')}</h3>
          <ol className="tw-mt-2 tw-grid tw-gap-1 tw-text-xs">
            {scanData.topImages.map((image) => (
              <li key={image.id} className="tw-flex tw-justify-between tw-gap-3">
                <span className="tw-min-w-0 tw-truncate" title={image.url}>
                  {image.loc ? (
                    <StorageConversationLink
                      conversationId={image.conversationId}
                      title={image.title || String(image.id)}
                      source={image.source}
                      loc={image.loc}
                    />
                  ) : (
                    <span>#{image.id}</span>
                  )}{' '}
                  · {image.format.toUpperCase()} · #{image.id}
                </span>
                <span>{formatBytes(image.bytes)}</span>
              </li>
            ))}
          </ol>
          <ImageOptimizationPanel assets={scanData.topImages} scanValid={scanStatus === 'ready'} />
        </div>
      ) : null}
    </section>
  );
}

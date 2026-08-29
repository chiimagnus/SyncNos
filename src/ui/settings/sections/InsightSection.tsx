import { t } from '@i18n';
import type { InsightStats, InsightTimeRange } from '@viewmodels/settings/insight-stats';
import type { InsightLoadStatus } from '@viewmodels/settings/useSettingsSceneController';
import { hasInsightData } from '@viewmodels/settings/insight-stats';
import { InsightPanel } from '@ui/settings/sections/InsightPanel';
import { cardClassName } from '@ui/settings/ui';

function InsightStateCard(props: { title: string; detail?: string; tone?: 'default' | 'error' }) {
  const { title, detail, tone = 'default' } = props;

  return (
    <section
      className={[
        `${cardClassName} tw-flex tw-min-h-[220px] tw-flex-col tw-justify-center`,
        tone === 'error' ? 'tw-border-[var(--error)]' : '',
      ].join(' ')}
      aria-label={t('aboutYouInsightSectionTitle')}
    >
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
        {t('aboutYouInsightSectionTitle')}
      </h2>
      <div
        className={[
          'tw-mt-3 tw-text-lg tw-font-black',
          tone === 'error' ? 'tw-text-[var(--error)]' : 'tw-text-[var(--text-primary)]',
        ].join(' ')}
      >
        {title}
      </div>
      {detail ? (
        <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {detail}
        </div>
      ) : null}
    </section>
  );
}

export function InsightSection(props: {
  status: InsightLoadStatus;
  error: string;
  stats: InsightStats | null;
  range: InsightTimeRange;
  onChangeRange: (next: InsightTimeRange) => void;
}) {
  const { status, error, stats, range, onChangeRange } = props;

  if ((status === 'idle' || status === 'loading') && !stats) {
    return (
      <div className="tw-grid tw-gap-4">
        <InsightStateCard title={t('insightLoadingTitle')} />
      </div>
    );
  }

  if (status === 'error' && !stats) {
    return (
      <div className="tw-grid tw-gap-4">
        <InsightStateCard title={t('insightErrorTitle')} detail={error} tone="error" />
      </div>
    );
  }

  if (!stats || !hasInsightData(stats)) {
    return (
      <div className="tw-grid tw-gap-4">
        <InsightStateCard title={t('insightEmptyTitle')} />
      </div>
    );
  }

  return (
    <div className="tw-grid tw-gap-4">
      {status === 'error' && error ? (
        <div className="tw-text-xs tw-font-semibold tw-text-[var(--error)]" role="alert">
          {error}
        </div>
      ) : null}
      <InsightPanel stats={stats} range={range} onChangeRange={onChangeRange} />
    </div>
  );
}

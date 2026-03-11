import { t } from '../../../i18n';
import type { InsightStats, InsightTimeRange } from './insight-stats';
import { hasInsightData } from './insight-stats';
import { InsightPanel } from './InsightPanel';
import { cardClassName } from '../ui';

function InsightStateCard(props: {
  title: string;
  detail?: string;
  tone?: 'default' | 'error';
}) {
  const { title, detail, tone = 'default' } = props;

  return (
    <section
      className={[
        `${cardClassName} tw-flex tw-min-h-[220px] tw-flex-col tw-justify-center`,
        tone === 'error' ? 'tw-border-[var(--error)]' : '',
      ].join(' ')}
      aria-label={t('insightHeading')}
    >
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightHeading')}</h2>
      <div className={['tw-mt-3 tw-text-lg tw-font-black', tone === 'error' ? 'tw-text-[var(--error)]' : 'tw-text-[var(--text-primary)]'].join(' ')}>
        {title}
      </div>
      {detail ? <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">{detail}</div> : null}
    </section>
  );
}

export function InsightSection(props: {
  loading: boolean;
  error: string;
  stats: InsightStats | null;
  hasLoaded: boolean;
  range: InsightTimeRange;
  onChangeRange: (next: InsightTimeRange) => void;
}) {
  const { loading, error, stats, hasLoaded, range, onChangeRange } = props;

  if (loading || !hasLoaded) {
    return <InsightStateCard title={t('insightLoadingTitle')} />;
  }

  if (error) {
    return <InsightStateCard title={t('insightErrorTitle')} detail={error} tone="error" />;
  }

  if (!stats || !hasInsightData(stats)) {
    return <InsightStateCard title={t('insightEmptyTitle')} />;
  }

  return <InsightPanel stats={stats} range={range} onChangeRange={onChangeRange} />;
}

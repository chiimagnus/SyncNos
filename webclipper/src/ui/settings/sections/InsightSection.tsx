import type { InsightStats } from './insight-stats';
import { hasInsightData } from './insight-stats';
import { InsightPanel } from './InsightPanel';
import { cardClassName } from '../ui';

export function InsightSection(props: {
  loading: boolean;
  error: string;
  stats: InsightStats | null;
  hasLoaded: boolean;
}) {
  const { loading, error, stats, hasLoaded } = props;

  if (loading || !hasLoaded) {
    return (
      <section className={cardClassName} aria-label="Insight">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Insight</h2>
        <div className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">Loading insight…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cardClassName} aria-label="Insight">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Insight</h2>
        <div className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">暂无数据</div>
        <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{error}</div>
      </section>
    );
  }

  if (!stats || !hasInsightData(stats)) {
    return (
      <section className={cardClassName} aria-label="Insight">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Insight</h2>
        <div className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">开始你的第一次 clip</div>
      </section>
    );
  }

  return <InsightPanel stats={stats} />;
}

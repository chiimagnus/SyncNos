import type { InsightStats } from './insight-stats';
import { hasInsightData } from './insight-stats';
import { cardClassName } from '../ui';

export function InsightSection(props: {
  loading: boolean;
  error: string;
  stats: InsightStats | null;
  hasLoaded: boolean;
}) {
  const { loading, error, stats, hasLoaded } = props;

  const body = (() => {
    if (loading || !hasLoaded) {
      return 'Loading insight…';
    }

    if (error) {
      return `Error: ${error}`;
    }

    if (hasInsightData(stats)) {
      return 'Insight data ready.';
    }

    return 'No insight data yet.';
  })();

  return (
    <section className={cardClassName} aria-label="Insight">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Insight</h2>
      <div className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{body}</div>
    </section>
  );
}

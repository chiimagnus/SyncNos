import type { InsightStats } from './insight-stats';
import { hasInsightData } from './insight-stats';
import { InsightPanel } from './InsightPanel';
import { cardClassName } from '../ui';

function InsightStateCard(props: {
  title: string;
  subtitle: string;
  detail?: string;
}) {
  const { title, subtitle, detail } = props;

  return (
    <section className={`${cardClassName} tw-flex tw-min-h-[220px] tw-flex-col tw-justify-center`} aria-label="Insight">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Insight</h2>
      <div className="tw-mt-3 tw-text-lg tw-font-black tw-text-[var(--text)]">{title}</div>
      <div className="tw-mt-1 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{subtitle}</div>
      {detail ? <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{detail}</div> : null}
    </section>
  );
}

export function InsightSection(props: {
  loading: boolean;
  error: string;
  stats: InsightStats | null;
  hasLoaded: boolean;
}) {
  const { loading, error, stats, hasLoaded } = props;

  if (loading || !hasLoaded) {
    return <InsightStateCard title="Loading insight…" subtitle="正在读取你的本地 clip 统计。" />;
  }

  if (error) {
    return (
      <InsightStateCard title="暂无数据" subtitle="本地统计暂时不可用。" detail={error} />
    );
  }

  if (!stats || !hasInsightData(stats)) {
    return <InsightStateCard title="开始你的第一次 clip" subtitle="当你保存对话和文章后，这里会展示你的积累全貌。" />;
  }

  return <InsightPanel stats={stats} />;
}

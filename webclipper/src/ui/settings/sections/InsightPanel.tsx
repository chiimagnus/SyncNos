import { useLayoutEffect, useRef, useState } from 'react';

import { t } from '../../../i18n';
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts';

import {
  INSIGHT_OTHER_LABEL,
  type InsightDistributionItem,
  type InsightStats,
  type InsightTopConversation,
} from './insight-stats';
import { cardClassName } from '../ui';

function formatCount(value: number): string {
  return Number(value || 0).toLocaleString();
}

function DistributionChart(props: {
  items: InsightDistributionItem[];
  emptyText: string;
}) {
  const { items, emptyText } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{emptyText}</div>;
  }

  const chartHeight = Math.max(212, items.length * 48);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      const nextWidth = Math.max(0, Math.floor(node.getBoundingClientRect().width));
      setChartWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth));
    };

    updateSize();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [chartHeight, items.length]);

  return (
    <div ref={containerRef} style={{ height: chartHeight }} className="tw-w-full tw-min-w-0">
      {chartWidth > 0 ? (
        <BarChart width={chartWidth} height={chartHeight} data={items} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={136}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 700 }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(217, 89, 38, 0.08)' }}
            formatter={(value) => [formatCount(Number(value || 0)), t('insightTooltipClips')]}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'rgba(255, 247, 243, 0.98)',
              boxShadow: 'var(--shadow)',
            }}
          />
          <Bar dataKey="count" radius={[0, 10, 10, 0]} barSize={22}>
            {items.map((item) => (
              <Cell
                key={item.label}
                fill={item.label === INSIGHT_OTHER_LABEL ? 'var(--btn-bg-hover)' : 'var(--text)'}
              />
            ))}
          </Bar>
        </BarChart>
      ) : null}
    </div>
  );
}

function TopConversationList(props: {
  items: InsightTopConversation[];
}) {
  const { items } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{t('insightTopConversationsEmpty')}</div>;
  }

  return (
    <div className="tw-grid tw-gap-2.5">
      {items.map((item, index) => (
        <div key={item.conversationId} className="tw-grid tw-grid-cols-[auto_minmax(0,1fr)_auto] tw-items-start tw-gap-3">
          <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">{index + 1}.</div>
          <div className="tw-min-w-0">
            <div className="tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text)]">{item.title}</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{item.source}</div>
          </div>
          <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">
            {formatCount(item.messageCount)} {t('insightTurnsUnit')}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightPanel(props: {
  stats: InsightStats;
}) {
  const { stats } = props;

  return (
    <div className="tw-grid tw-gap-4">
      <section className="tw-grid tw-gap-3 md:tw-grid-cols-3" aria-label={t('insightOverviewAria')}>
        <div className={`${cardClassName} tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between`}>
          <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">
            {t('insightOverviewTotalClips')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.totalClips)}</div>
        </div>
        <div className={`${cardClassName} tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between`}>
          <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">
            {t('insightOverviewChatCount')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.chatCount)}</div>
        </div>
        <div className={`${cardClassName} tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between`}>
          <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">
            {t('insightOverviewArticleCount')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.articleCount)}</div>
        </div>
      </section>

      <div className="tw-grid tw-gap-4 lg:tw-grid-cols-2">
        <section className={`${cardClassName} tw-h-full tw-min-w-0`} aria-label={t('insightChatSectionAria')}>
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">{t('insightChatSectionTitle')}</h2>

          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text)]">{t('insightSourceDistributionTitle')}</div>
            <DistributionChart items={stats.chatSourceDistribution} emptyText={t('insightDistributionEmpty')} />
          </div>

          <div className="tw-mt-5">
            <div className="tw-mb-2 tw-flex tw-items-start tw-justify-between tw-gap-4">
              <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">{t('insightTopConversationsTitle')}</div>
              <div className="tw-text-right">
                <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">
                  {t('insightTotalMessagesLabel')}
                </div>
                <div className="tw-mt-1 tw-text-2xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.totalMessages)}</div>
              </div>
            </div>
            <TopConversationList items={stats.topConversations} />
          </div>
        </section>

        <section className={`${cardClassName} tw-h-full tw-min-w-0`} aria-label={t('insightArticlesSectionAria')}>
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">{t('insightArticlesSectionTitle')}</h2>
          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text)]">{t('insightArticleDomainsTitle')}</div>
            <DistributionChart items={stats.articleDomainDistribution} emptyText={t('insightDistributionEmpty')} />
          </div>
        </section>
      </div>
    </div>
  );
}

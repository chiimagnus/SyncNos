import { useLayoutEffect, useRef, useState } from 'react';

import { t } from '../../../i18n';
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts';

import {
  INSIGHT_OTHER_LABEL,
  type InsightDistributionItem,
  type InsightStats,
  type InsightTopConversation,
} from './insight-stats';
import type { InsightTimeRange } from './insight-stats';
import { cardClassName, selectClassName } from '../ui';

const CHART_BASE_COLOR = 'var(--accent)';

function formatCount(value: number): string {
  return Number(value || 0).toLocaleString();
}

function getOrangeBarFill(index: number, total: number): string {
  const safeTotal = Math.max(1, Math.floor(total || 0));
  if (safeTotal <= 1) return CHART_BASE_COLOR;

  const safeIndex = Math.min(Math.max(0, Math.floor(index || 0)), safeTotal - 1);
  const t = safeTotal === 1 ? 0 : safeIndex / (safeTotal - 1);

  // Top to bottom: stronger -> lighter tint towards card background.
  // Keep the tail visible on light mode (bg-card is near white).
  const colorPercent = Math.round(92 - t * 44); // 92% -> 48%
  const clamped = Math.min(94, Math.max(42, colorPercent));
  return `color-mix(in srgb, ${CHART_BASE_COLOR} ${clamped}%, var(--bg-card))`;
}

function DistributionChart(props: {
  items: InsightDistributionItem[];
  emptyText: string;
}) {
  const { items, emptyText } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{emptyText}</div>;
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
            tick={{ fill: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}
          />
          <Tooltip
            cursor={{ fill: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
            formatter={(value) => [formatCount(Number(value || 0)), t('insightTooltipClips')]}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              boxShadow: 'none',
            }}
          />
          <Bar dataKey="count" radius={[0, 10, 10, 0]} barSize={22}>
            {items.map((item, index) => (
              <Cell key={item.label} fill={getOrangeBarFill(index, items.length)} />
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
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('insightTopConversationsEmpty')}</div>;
  }

  const rankToneClassName = (index: number) => {
    if (index === 0) return 'tw-text-[#FFA500]';
    if (index === 1) return 'tw-text-[var(--info)]';
    if (index === 2) return 'tw-text-[var(--secondary)]';
    return 'tw-text-[var(--text-primary)]';
  };

  return (
    <div className="tw-grid tw-gap-2.5">
      {items.map((item, index) => (
        <div key={item.conversationId} className="tw-grid tw-grid-cols-[auto_minmax(0,1fr)_auto] tw-items-start tw-gap-3">
          <div className={['tw-text-sm tw-font-black', rankToneClassName(index)].join(' ')}>{index + 1}.</div>
          <div className="tw-min-w-0">
            <div className="tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text-primary)]">{item.title}</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{item.source}</div>
          </div>
          <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">
            {formatCount(item.messageCount)} {t('insightTurnsUnit')}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightPanel(props: {
  stats: InsightStats;
  range: InsightTimeRange;
  onChangeRange: (next: InsightTimeRange) => void;
}) {
  const { stats, range, onChangeRange } = props;

  return (
    <div className="tw-grid tw-gap-4">
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-3">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightHeading')}</h2>
        <select
          className={selectClassName}
          value={range}
          onChange={(event) => onChangeRange(event.target.value as InsightTimeRange)}
          aria-label={t('insightRangeAria')}
        >
          <option value="all">{t('insightRangeAll')}</option>
          <option value="today">{t('insightRangeToday')}</option>
          <option value="7d">{t('insightRange7d')}</option>
          <option value="30d">{t('insightRange30d')}</option>
        </select>
      </header>

      <section className="tw-grid tw-gap-3 md:tw-grid-cols-3" aria-label={t('insightOverviewAria')}>
        <div
          className={[
            cardClassName,
            'tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between',
            'tw-border-[color-mix(in_srgb,#FFA500_32%,var(--border))]',
            'tw-bg-[color-mix(in_srgb,#FFA500_10%,var(--bg-card))]',
          ].join(' ')}
        >
          <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">
            <span className="tw-inline-flex tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-[#FFA500]" aria-hidden="true" />
            {t('insightOverviewTotalClips')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[#FFA500]">{formatCount(stats.totalClips)}</div>
        </div>
        <div
          className={[
            cardClassName,
            'tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between',
            'tw-border-[color-mix(in_srgb,var(--info)_34%,var(--border))]',
            'tw-bg-[color-mix(in_srgb,var(--info)_10%,var(--bg-card))]',
          ].join(' ')}
        >
          <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">
            <span className="tw-inline-flex tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-[var(--info)]" aria-hidden="true" />
            {t('insightOverviewChatCount')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--info)]">{formatCount(stats.chatCount)}</div>
        </div>
        <div
          className={[
            cardClassName,
            'tw-flex tw-min-h-[124px] tw-flex-col tw-justify-between',
            'tw-border-[color-mix(in_srgb,var(--secondary)_34%,var(--border))]',
            'tw-bg-[color-mix(in_srgb,var(--secondary)_10%,var(--bg-card))]',
          ].join(' ')}
        >
          <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">
            <span className="tw-inline-flex tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-[var(--secondary)]" aria-hidden="true" />
            {t('insightOverviewArticleCount')}
          </div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--secondary)]">{formatCount(stats.articleCount)}</div>
        </div>
      </section>

      <div className="tw-grid tw-gap-4 lg:tw-grid-cols-2">
        <section className={`${cardClassName} tw-h-full tw-min-w-0`} aria-label={t('insightChatSectionAria')}>
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightChatSectionTitle')}</h2>

          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{t('insightSourceDistributionTitle')}</div>
            <DistributionChart items={stats.chatSourceDistribution} emptyText={t('insightDistributionEmpty')} />
          </div>

          <div className="tw-mt-5">
            <div className="tw-mb-2 tw-flex tw-items-start tw-justify-between tw-gap-4">
              <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{t('insightTopConversationsTitle')}</div>
              <div className="tw-text-right">
                <div className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">{t('insightTotalMessagesLabel')}</div>
                <div className="tw-mt-1 tw-text-2xl tw-font-black tw-text-[#FFA500]">{formatCount(stats.totalMessages)}</div>
              </div>
            </div>
            <TopConversationList items={stats.topConversations} />
          </div>
        </section>

        <section className={`${cardClassName} tw-h-full tw-min-w-0`} aria-label={t('insightArticlesSectionAria')}>
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightArticlesSectionTitle')}</h2>
          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{t('insightArticleDomainsTitle')}</div>
            <DistributionChart items={stats.articleDomainDistribution} emptyText={t('insightDistributionEmpty')} />
          </div>
        </section>
      </div>
    </div>
  );
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { t } from '../../../i18n';
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts';

import {
  type InsightDailyTrendPoint,
  type InsightDistributionItem,
  type InsightStats,
  type InsightTopConversation,
  INSIGHT_UNKNOWN_DATE_LABEL,
} from './insight-stats';
import type { InsightTimeRange } from './insight-stats';
import { cardClassName, selectClassName } from '../ui';
import { useConversationsApp } from '../../conversations/conversations-context';
import { useIsNarrowScreen } from '../../shared/hooks/useIsNarrowScreen';
import { SelectMenu } from '../../shared/SelectMenu';
import { openConversation as openConversationInApp } from '../../conversations/open-conversation';
import { buildConversationRouteFromLoc, encodeConversationLoc } from '../../../shared/conversation-loc';

const CHART_BASE_COLOR = 'var(--accent)';

function formatCount(value: number): string {
  return Number(value || 0).toLocaleString();
}

function formatTrendDayLabel(dayStart: number, mode: 'short' | 'long'): string {
  const safeDayStart = Number(dayStart);
  if (!Number.isFinite(safeDayStart) || safeDayStart === -1) return INSIGHT_UNKNOWN_DATE_LABEL;

  const options: Intl.DateTimeFormatOptions =
    mode === 'short'
      ? { month: 'numeric', day: 'numeric' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(safeDayStart));
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
            itemStyle={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 800 }}
            labelStyle={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
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

function DailyTrendChart(props: {
  items: InsightDailyTrendPoint[];
  stroke: string;
  ariaLabel: string;
}) {
  const { items, stroke, ariaLabel } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('insightDistributionEmpty')}</div>;
  }

  const chartHeight = 204;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const labelMode: 'short' | 'long' = items.length <= 32 ? 'short' : 'long';
  const shouldRenderDot = items.length <= 90;
  const shouldRenderLabels = items.length <= 16;

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
  }, []);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      style={{ height: chartHeight }}
      className="tw-w-full tw-min-w-0"
    >
      {chartWidth > 0 ? (
        <AreaChart
          width={chartWidth}
          height={chartHeight}
          data={items}
          margin={{ top: 26, right: 16, bottom: 36, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dayStart"
            axisLine={false}
            tickLine={false}
            minTickGap={18}
            interval="preserveStartEnd"
            angle={-42}
            textAnchor="end"
            height={44}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
            tickFormatter={(value) => formatTrendDayLabel(Number(value), labelMode)}
          />
          <YAxis
            dataKey="count"
            axisLine={false}
            tickLine={false}
            width={34}
            allowDecimals={false}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
          />
          <Tooltip
            cursor={{ stroke: 'color-mix(in srgb, var(--accent) 26%, transparent)', strokeWidth: 1 }}
            formatter={(value) => [formatCount(Number(value || 0)), t('insightTooltipClips')]}
            labelFormatter={(label) => formatTrendDayLabel(Number(label), 'long')}
            itemStyle={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 800 }}
            labelStyle={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              boxShadow: 'none',
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={stroke}
            strokeWidth={2}
            fill={`color-mix(in srgb, ${stroke} 22%, transparent)`}
            fillOpacity={1}
            dot={shouldRenderDot ? { r: 2.5, strokeWidth: 2, fill: 'var(--bg-card)' } : false}
            activeDot={{ r: 4, strokeWidth: 2, fill: 'var(--bg-card)' }}
            isAnimationActive={false}
          >
            {shouldRenderLabels ? (
              <LabelList
                dataKey="count"
                position="top"
                content={(labelProps: any) => {
                  const value = Number(labelProps?.value || 0);
                  if (!Number.isFinite(value) || value <= 0) return null;
                  const x = Number(labelProps?.x || 0);
                  const y = Number(labelProps?.y || 0);
                  const textY = y < 22 ? y + 16 : y - 6;
                  return (
                    <text
                      x={x}
                      y={textY}
                      textAnchor="middle"
                      fill="var(--text-secondary)"
                      fontSize={12}
                      fontWeight={800}
                    >
                      {formatCount(value)}
                    </text>
                  );
                }}
              />
            ) : null}
          </Area>
        </AreaChart>
      ) : null}
    </div>
  );
}

function TopConversationList(props: {
  items: InsightTopConversation[];
  getLinkTo: (conversationId: number) => string;
  onOpenConversation: (conversationId: number) => void;
}) {
  const { items, getLinkTo, onOpenConversation } = props;
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
            <Link
              to={getLinkTo(item.conversationId)}
              replace
              className={[
                'tw-group tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-left',
                'tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text-primary)]',
                'hover:tw-opacity-85',
                'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
              ].join(' ')}
              title={item.title}
              aria-label={item.title}
              onClick={(event) => {
                if (event.defaultPrevented) return;
                if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
                onOpenConversation(item.conversationId);
              }}
            >
              <span className="tw-min-w-0 tw-truncate tw-underline-offset-2 group-hover:tw-underline">{item.title}</span>
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="tw-shrink-0 tw-text-[var(--text-secondary)] tw-opacity-70 group-hover:tw-opacity-100" />
            </Link>
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
  const { items, openConversationExternalById, clearSelected } = useConversationsApp();
  const isNarrow = useIsNarrowScreen();
  const routerLocation = useLocation();
  const fallbackTo = useMemo(() => {
    const state: any = (routerLocation as any)?.state ?? {};
    const from = String(state?.from || '').trim();
    return from || '/';
  }, [routerLocation]);

  const routeByConversationId = useMemo(() => {
    const map = new Map<number, string>();
    for (const conversation of items) {
      const id = Number((conversation as any).id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const loc = encodeConversationLoc({
        source: String((conversation as any).source || ''),
        conversationKey: String((conversation as any).conversationKey || ''),
      });
      map.set(id, buildConversationRouteFromLoc(loc));
    }
    return map;
  }, [items]);

  const getLinkTo = (conversationId: number) => routeByConversationId.get(Number(conversationId)) || fallbackTo;

  const onOpenConversation = (conversationId: number) => {
    openConversationInApp(conversationId, {
      clearSelected,
      isNarrow,
      setActiveId: (id) => openConversationExternalById(Number(id)),
    });
  };

  return (
    <div className="tw-grid tw-gap-4">
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-3">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightHeading')}</h2>
        <SelectMenu<InsightTimeRange>
          value={range}
          onChange={onChangeRange}
          ariaLabel={t('insightRangeAria')}
          buttonClassName={selectClassName}
          options={[
            { value: 'all', label: t('insightRangeAll') },
            { value: 'today', label: t('insightRangeToday') },
            { value: '7d', label: t('insightRange7d') },
            { value: '30d', label: t('insightRange30d') },
          ]}
        />
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

          <div className="tw-mt-3">
            <DailyTrendChart items={stats.chatDailyTrend} stroke="var(--info)" ariaLabel={t('insightOverviewChatCount')} />
          </div>

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
            <TopConversationList items={stats.topConversations} getLinkTo={getLinkTo} onOpenConversation={onOpenConversation} />
          </div>
        </section>

        <section className={`${cardClassName} tw-h-full tw-min-w-0`} aria-label={t('insightArticlesSectionAria')}>
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('insightArticlesSectionTitle')}</h2>
          <div className="tw-mt-3">
            <DailyTrendChart items={stats.articleDailyTrend} stroke="var(--secondary)" ariaLabel={t('insightOverviewArticleCount')} />
          </div>
          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{t('insightArticleDomainsTitle')}</div>
            <DistributionChart items={stats.articleDomainDistribution} emptyText={t('insightDistributionEmpty')} />
          </div>
        </section>
      </div>
    </div>
  );
}

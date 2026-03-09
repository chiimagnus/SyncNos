import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { InsightDistributionItem, InsightStats, InsightTopConversation } from './insight-stats';
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

  const chartHeight = Math.max(180, items.length * 46);

  return (
    <div style={{ height: chartHeight }} className="tw-w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={88}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 700 }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15, 23, 42, 0.06)' }}
            formatter={(value) => [formatCount(Number(value || 0)), 'Clips']}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid rgba(15, 23, 42, 0.08)',
              background: 'rgba(255, 255, 255, 0.96)',
              boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
            }}
          />
          <Bar dataKey="count" radius={[0, 10, 10, 0]} barSize={22}>
            {items.map((item) => (
              <Cell
                key={item.label}
                fill={item.label === 'Other' ? 'rgba(100, 116, 139, 0.55)' : 'rgba(15, 23, 42, 0.78)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopConversationList(props: {
  items: InsightTopConversation[];
}) {
  const { items } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">暂无数据</div>;
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
          <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">{formatCount(item.messageCount)} 轮</div>
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
      <section className="tw-grid tw-gap-3 md:tw-grid-cols-3" aria-label="Insight overview">
        <div className={cardClassName}>
          <div className="tw-text-xs tw-font-black tw-uppercase tw-tracking-[0.12em] tw-text-[var(--muted)]">📦 总 Clip</div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.totalClips)}</div>
        </div>
        <div className={cardClassName}>
          <div className="tw-text-xs tw-font-black tw-uppercase tw-tracking-[0.12em] tw-text-[var(--muted)]">💬 AI 对话</div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.chatCount)}</div>
        </div>
        <div className={cardClassName}>
          <div className="tw-text-xs tw-font-black tw-uppercase tw-tracking-[0.12em] tw-text-[var(--muted)]">📄 网页文章</div>
          <div className="tw-mt-2 tw-text-3xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.articleCount)}</div>
        </div>
      </section>

      <div className="tw-grid tw-gap-4 lg:tw-grid-cols-2">
        <section className={cardClassName} aria-label="AI Conversations">
          <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
            <div>
              <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">💬 AI Conversations</h2>
              <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">平台分布 + 总消息轮数 + Top 3 最长对话</div>
            </div>
            <div className="tw-text-right">
              <div className="tw-text-xs tw-font-black tw-uppercase tw-tracking-[0.12em] tw-text-[var(--muted)]">总消息轮数</div>
              <div className="tw-mt-1 tw-text-2xl tw-font-black tw-text-[var(--text)]">{formatCount(stats.totalMessages)}</div>
            </div>
          </div>

          <div className="tw-mt-4">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text)]">平台分布</div>
            <DistributionChart items={stats.chatSourceDistribution} emptyText="暂无数据" />
          </div>

          <div className="tw-mt-5">
            <div className="tw-mb-2 tw-text-sm tw-font-black tw-text-[var(--text)]">🏆 Top 3 最长对话</div>
            <TopConversationList items={stats.topConversations} />
          </div>
        </section>

        <section className={cardClassName} aria-label="Web Articles">
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">📄 Web Articles</h2>
          <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">域名分布</div>
          <div className="tw-mt-4">
            <DistributionChart items={stats.articleDomainDistribution} emptyText="暂无数据" />
          </div>
        </section>
      </div>
    </div>
  );
}

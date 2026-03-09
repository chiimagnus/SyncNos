import type { InsightDistributionItem, InsightStats, InsightTopConversation } from './insight-stats';
import { cardClassName } from '../ui';

function formatCount(value: number): string {
  return Number(value || 0).toLocaleString();
}

function DistributionList(props: {
  items: InsightDistributionItem[];
  emptyText: string;
}) {
  const { items, emptyText } = props;
  if (!items.length) {
    return <div className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{emptyText}</div>;
  }

  return (
    <div className="tw-grid tw-gap-2">
      {items.map((item) => (
        <div key={item.label} className="tw-grid tw-grid-cols-[minmax(0,1fr)_auto] tw-items-center tw-gap-3">
          <div className="tw-min-w-0">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text)]">{item.label}</span>
              <div className="tw-h-2 tw-flex-1 tw-rounded-full tw-bg-[var(--panel)]/70">
                <div
                  className="tw-h-2 tw-rounded-full tw-bg-[var(--text)]/70"
                  style={{ width: `${Math.max(10, Math.min(100, item.count * 12))}%` }}
                />
              </div>
            </div>
          </div>
          <span className="tw-text-sm tw-font-black tw-text-[var(--text)]">{formatCount(item.count)}</span>
        </div>
      ))}
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
            <DistributionList items={stats.chatSourceDistribution} emptyText="暂无数据" />
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
            <DistributionList items={stats.articleDomainDistribution} emptyText="暂无数据" />
          </div>
        </section>
      </div>
    </div>
  );
}

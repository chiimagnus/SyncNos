import { t } from '@i18n';
import type { InsightStats, InsightTimeRange } from '@viewmodels/settings/insight-stats';
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

function UserNameCard(props: { value: string; onChange: (next: string) => void }) {
  const { value, onChange } = props;
  return (
    <section className={cardClassName} aria-label={t('aboutYouUserNameSectionAria')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
        {t('aboutYouUserNameSectionTitle')}
      </h2>
      <input
        className={[
          'tw-mt-3 tw-w-full tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)]',
          'tw-px-3 tw-py-2 tw-text-sm tw-font-semibold tw-text-[var(--text-primary)]',
          'focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-[var(--focus)] focus-visible:tw-ring-offset-2',
          'focus-visible:tw-ring-offset-[var(--bg-card)]',
        ].join(' ')}
        value={value}
        onChange={(e) => onChange(String((e.target as any)?.value || ''))}
        placeholder={t('aboutYouUserNamePlaceholder')}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
        {t('aboutYouUserNameHint')}
      </div>
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
  userName: string;
  onChangeUserName: (next: string) => void;
}) {
  const { loading, error, stats, hasLoaded, range, onChangeRange, userName, onChangeUserName } = props;

  if (loading || !hasLoaded) {
    return (
      <div className="tw-grid tw-gap-4">
        <UserNameCard value={userName} onChange={onChangeUserName} />
        <InsightStateCard title={t('insightLoadingTitle')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="tw-grid tw-gap-4">
        <UserNameCard value={userName} onChange={onChangeUserName} />
        <InsightStateCard title={t('insightErrorTitle')} detail={error} tone="error" />
      </div>
    );
  }

  if (!stats || !hasInsightData(stats)) {
    return (
      <div className="tw-grid tw-gap-4">
        <UserNameCard value={userName} onChange={onChangeUserName} />
        <InsightStateCard title={t('insightEmptyTitle')} />
      </div>
    );
  }

  return (
    <div className="tw-grid tw-gap-4">
      <UserNameCard value={userName} onChange={onChangeUserName} />
      <InsightPanel stats={stats} range={range} onChangeRange={onChangeRange} />
    </div>
  );
}

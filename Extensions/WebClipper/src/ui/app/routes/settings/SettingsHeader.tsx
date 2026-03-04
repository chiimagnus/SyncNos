import { primaryButtonClassName } from './ui';

export function SettingsHeader(props: { busy: boolean; onRefresh: () => void; error: string | null }) {
  const { busy, onRefresh, error } = props;
  return (
    <>
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-4">
        <div>
          <h1 className="tw-m-0 tw-text-[26px] tw-font-black tw-leading-none tw-tracking-[-0.01em] tw-text-[var(--text)]">Settings</h1>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Sync integrations, backup, and app behavior controls.</p>
        </div>
        <button onClick={onRefresh} disabled={busy} type="button" className={primaryButtonClassName}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{error}</p> : null}
    </>
  );
}


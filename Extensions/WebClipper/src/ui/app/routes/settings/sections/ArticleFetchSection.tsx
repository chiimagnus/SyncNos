import { buttonClassName, buttonStyle, cardClassName, cardStyle } from '../ui';

function statusToneClass(status: string) {
  const s = String(status || '').toLowerCase();
  if (s.includes('fetch')) return 'tw-text-[var(--muted)]';
  if (s.startsWith('error')) return 'tw-text-[var(--danger)]';
  if (s.includes('saved') || s.includes('done') || s.includes('ok') || s.includes('✓')) return 'tw-text-[var(--wc-ok)]';
  return 'tw-text-[var(--muted)]';
}

export function ArticleFetchSection(props: { busy: boolean; status: string; onFetch: () => void }) {
  const { busy, status, onFetch } = props;

  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Article Fetch">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Article Fetch</h2>
      <div className="tw-mt-2 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
        Fetch the current active tab article and save it into your conversations database.
      </div>

      <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <button className={buttonClassName} style={buttonStyle as any} onClick={onFetch} disabled={busy}>
          Fetch Current Page
        </button>
        <div className={['tw-text-xs tw-font-semibold', statusToneClass(status)].join(' ')} aria-label="Article fetch status">
          {status}
        </div>
      </div>
    </section>
  );
}


import { buttonClassName, cardClassName, cardStyle } from '../ui';

export function ArticleFetchSection(props: { busy: boolean; statusText: string; onFetchCurrentPage: () => void }) {
  const { busy, statusText, onFetchCurrentPage } = props;
  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Article Fetch">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Article Fetch</h2>
      <button onClick={onFetchCurrentPage} disabled={busy} style={{ marginTop: 10 }} type="button" className={buttonClassName}>
        Fetch Current Page
      </button>
      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>status: {statusText}</div>
    </section>
  );
}


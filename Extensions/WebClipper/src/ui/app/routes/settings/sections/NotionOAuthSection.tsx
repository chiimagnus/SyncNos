import type { NotionPageOption } from '../utils';
import { buttonClassName, cardClassName, selectClassName } from '../ui';

export function NotionOAuthSection(props: {
  busy: boolean;
  notionStatusText: string;
  notionConnected: boolean;
  pollingNotion: boolean;
  loadingNotionPages: boolean;
  notionParentPageId: string;
  notionPageOptions: NotionPageOption[];
  notionLogoUrl: string;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => void;
  onLoadNotionPages: () => void;
}) {
  const {
    busy,
    notionStatusText,
    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionParentPageId,
    notionPageOptions,
    notionLogoUrl,
    onConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,
  } = props;

  return (
    <section className={cardClassName} aria-label="Notion settings">
      <div className="tw-flex tw-items-center tw-gap-2">
        <img className="tw-h-5 tw-w-5 tw-shrink-0" src={notionLogoUrl} alt="" aria-hidden="true" />
        <div className="tw-min-w-0 tw-flex-1 tw-text-[var(--text)]">
          <span className="tw-text-base tw-font-extrabold">Notion OAuth</span>
          <span className="tw-mx-2 tw-text-[var(--muted)]" aria-hidden="true">
            |
          </span>
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{notionStatusText}</span>
        </div>
        <button onClick={onConnectOrDisconnect} disabled={busy} type="button" className={buttonClassName}>
          {notionConnected ? 'Disconnect' : pollingNotion ? 'Connecting…' : 'Connect'}
        </button>
      </div>

      <div className="tw-mt-3 tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3" aria-label="Parent page selector">
        <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Parent Page</div>
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <select
            id="notionPages"
            className={`${selectClassName} tw-w-full`}
            value={notionParentPageId}
            disabled={busy || !notionConnected}
            onChange={(e) => onSaveNotionParentPage(e.target.value)}
          >
            {notionPageOptions.length ? null : <option value="">{notionConnected ? 'Click refresh →' : 'Connect Notion first'}</option>}
            {notionPageOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Refresh"
            onClick={onLoadNotionPages}
            disabled={busy || !notionConnected || loadingNotionPages}
            className="tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-xs tw-font-black tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)] disabled:tw-cursor-not-allowed disabled:tw-opacity-60"
            aria-label="Refresh pages"
          >
            ↻
          </button>
        </div>
      </div>
    </section>
  );
}

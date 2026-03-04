import type { NotionPageOption } from '../utils';
import { formatTime } from '../utils';
import { buttonClassName, cardClassName, cardStyle, selectClassName } from '../ui';

export function NotionOAuthSection(props: {
  busy: boolean;
  notionStatusText: string;
  notionClientId: string;
  notionConnected: boolean;
  pollingNotion: boolean;
  loadingNotionPages: boolean;
  notionParentPageId: string;
  notionPageOptions: NotionPageOption[];
  notionJob: any;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => void;
  onLoadNotionPages: () => void;
}) {
  const {
    busy,
    notionStatusText,
    notionClientId,
    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionParentPageId,
    notionPageOptions,
    notionJob,
    onConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,
  } = props;

  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Notion OAuth">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Notion OAuth</h2>
      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>status: {notionStatusText}</div>
      <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>clientId: {notionClientId ? notionClientId : '(missing)'}</div>
      <button onClick={onConnectOrDisconnect} disabled={busy} style={{ marginTop: 10 }} type="button" className={buttonClassName}>
        {notionConnected ? 'Disconnect' : pollingNotion ? 'Connecting…' : 'Connect'}
      </button>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Parent Page</div>
          <select
            value={notionParentPageId}
            disabled={busy || !notionConnected}
            onChange={(e) => onSaveNotionParentPage(e.target.value)}
            style={{ width: '100%' }}
            className={selectClassName}
          >
            {notionPageOptions.length ? null : <option value="">{notionConnected ? 'Click refresh →' : 'Connect Notion first'}</option>}
            {notionPageOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <button onClick={onLoadNotionPages} disabled={busy || !notionConnected || loadingNotionPages} type="button" className={buttonClassName}>
          {loadingNotionPages ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginTop: 12, opacity: 0.85, fontSize: 12 }}>
        sync status: {String(notionJob?.status ?? 'idle')} · updated: {formatTime(notionJob?.updatedAt)}
      </div>
      {notionJob?.error ? (
        <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: 'crimson' }}>{String(notionJob.error)}</pre>
      ) : null}
    </section>
  );
}


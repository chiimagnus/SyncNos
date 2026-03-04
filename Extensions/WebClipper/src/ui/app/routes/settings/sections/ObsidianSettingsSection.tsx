import { formatTime } from '../utils';
import { buttonClassName, buttonStyle, cardClassName, cardStyle, textInputClassName } from '../ui';

export function ObsidianSettingsSection(props: {
  busy: boolean;
  apiBaseUrl: string;
  authHeaderName: string;
  apiKeyDraft: string;
  apiKeyPresent: boolean;
  chatFolder: string;
  articleFolder: string;
  testResult: string;
  job: any;
  onChangeApiBaseUrl: (v: string) => void;
  onChangeAuthHeaderName: (v: string) => void;
  onChangeApiKeyDraft: (v: string) => void;
  onChangeChatFolder: (v: string) => void;
  onChangeArticleFolder: (v: string) => void;
  onSave: () => void;
  onTest: () => void;
  onClearKey: () => void;
}) {
  const {
    busy,
    apiBaseUrl,
    authHeaderName,
    apiKeyDraft,
    apiKeyPresent,
    chatFolder,
    articleFolder,
    testResult,
    job,
    onChangeApiBaseUrl,
    onChangeAuthHeaderName,
    onChangeApiKeyDraft,
    onChangeChatFolder,
    onChangeArticleFolder,
    onSave,
    onTest,
    onClearKey,
  } = props;

  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Obsidian Settings">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Obsidian</h2>

      <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>API Base URL</div>
          <input value={apiBaseUrl} onChange={(e) => onChangeApiBaseUrl(e.target.value)} disabled={busy} spellCheck={false} className={textInputClassName} />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>API Key</div>
          <input
            value={apiKeyDraft}
            onChange={(e) => onChangeApiKeyDraft(e.target.value)}
            disabled={busy}
            placeholder={apiKeyPresent ? '(configured)' : ''}
            className={textInputClassName}
          />
          <div style={{ fontSize: 12, opacity: 0.75 }}>status: {apiKeyPresent ? 'configured' : 'not configured'} (value not displayed)</div>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Auth Header</div>
          <input
            value={authHeaderName}
            onChange={(e) => onChangeAuthHeaderName(e.target.value)}
            disabled={busy}
            spellCheck={false}
            className={textInputClassName}
          />
        </label>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>AI Chats Folder</div>
            <input value={chatFolder} onChange={(e) => onChangeChatFolder(e.target.value)} disabled={busy} spellCheck={false} className={textInputClassName} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Web Articles Folder</div>
            <input
              value={articleFolder}
              onChange={(e) => onChangeArticleFolder(e.target.value)}
              disabled={busy}
              spellCheck={false}
              className={textInputClassName}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={buttonClassName} style={buttonStyle as any} onClick={onSave} disabled={busy}>
            Save
          </button>
          <button className={buttonClassName} style={buttonStyle as any} onClick={onTest} disabled={busy}>
            Test Connection
          </button>
          <button className={buttonClassName} style={buttonStyle as any} onClick={onClearKey} disabled={busy}>
            Clear API key
          </button>
        </div>

        {testResult ? <div style={{ opacity: 0.85, fontSize: 12 }}>test: {testResult}</div> : null}

        <div style={{ opacity: 0.85, fontSize: 12 }}>
          sync status: {String(job?.status ?? 'idle')} · started: {formatTime(job?.startedAt)}
        </div>
      </div>
    </section>
  );
}


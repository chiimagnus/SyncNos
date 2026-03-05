import type { KeyboardEvent } from 'react';

import { buttonClassName, cardClassName, textInputClassName } from '../ui';

export function ObsidianSettingsSection(props: {
  busy: boolean;
  apiBaseUrl: string;
  authHeaderName: string;
  apiKeyDraft: string;
  apiKeyPresent: boolean;
  apiKeyMasked: string;
  chatFolder: string;
  articleFolder: string;
  statusText: string;
  obsidianLogoUrl: string;
  onChangeApiBaseUrl: (v: string) => void;
  onChangeAuthHeaderName: (v: string) => void;
  onChangeApiKeyDraft: (v: string) => void;
  onChangeChatFolder: (v: string) => void;
  onChangeArticleFolder: (v: string) => void;
  onSave: () => void;
  onSaveApiKey: () => void;
  onTest: () => void;
  onOpenSetupGuide: () => void;
}) {
  const {
    busy,
    apiBaseUrl,
    authHeaderName,
    apiKeyDraft,
    apiKeyPresent,
    apiKeyMasked,
    chatFolder,
    articleFolder,
    statusText,
    obsidianLogoUrl,
    onChangeApiBaseUrl,
    onChangeAuthHeaderName,
    onChangeApiKeyDraft,
    onChangeChatFolder,
    onChangeArticleFolder,
    onSave,
    onSaveApiKey,
    onTest,
    onOpenSetupGuide,
  } = props;

  const onEnterToSave = (e: KeyboardEvent<HTMLInputElement>, mode: 'default' | 'apiKey' = 'default') => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (mode === 'apiKey') {
      if (!String(apiKeyDraft || '').trim()) return;
      onSaveApiKey();
      return;
    }
    onSave();
  };

  return (
    <>
      <section className={cardClassName} aria-label="Obsidian Local REST API">
        <div className="tw-flex tw-items-center tw-gap-2">
          <img className="tw-h-5 tw-w-5 tw-shrink-0" src={obsidianLogoUrl} alt="" aria-hidden="true" />
          <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Obsidian Local REST API</h2>
        </div>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Base URL</div>
            <input
              value={apiBaseUrl}
              onChange={(e) => onChangeApiBaseUrl(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="http://127.0.0.1:27123"
              className={textInputClassName}
              aria-label="Obsidian API base url"
            />
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">API Key</div>
            <input
              value={apiKeyDraft}
              onChange={(e) => onChangeApiKeyDraft(e.target.value)}
              onBlur={() => {
                if (!String(apiKeyDraft || '').trim()) return;
                onSaveApiKey();
              }}
              onKeyDown={(e) => onEnterToSave(e, 'apiKey')}
              disabled={busy}
              placeholder={apiKeyPresent ? apiKeyMasked : ''}
              className={textInputClassName}
              aria-label="Obsidian API key"
            />
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Auth Header</div>
            <input
              value={authHeaderName}
              onChange={(e) => onChangeAuthHeaderName(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="Authorization"
              className={textInputClassName}
              aria-label="Obsidian auth header name"
            />
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]"> </div>
            <div className="tw-flex tw-items-center tw-gap-2">
              <button className={buttonClassName} onClick={onTest} disabled={busy} type="button">
                Test
              </button>
            </div>
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-start tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Status</div>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{statusText}</div>
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-start tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Note</div>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
              Install and configure Obsidian Local REST API first.{' '}
              <a
                className="tw-underline hover:tw-opacity-80"
                href="https://github.com/chiimagnus/SyncNos/blob/main/.github/guide/obsidian/LocalRestAPI.zh.md"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenSetupGuide();
                }}
              >
                Open Setup Guide
              </a>
            </div>
          </div>

        </div>
      </section>

      <section className={cardClassName} aria-label="Obsidian Paths">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Obsidian Paths</h2>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">AI Chats Folder</div>
            <input
              value={chatFolder}
              onChange={(e) => onChangeChatFolder(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-AIChats"
              className={textInputClassName}
              aria-label="Obsidian AI chats folder"
            />
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Web Clipper Folder</div>
            <input
              value={articleFolder}
              onChange={(e) => onChangeArticleFolder(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-WebArticles"
              className={textInputClassName}
              aria-label="Obsidian web clipper folder"
            />
          </div>

          <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-start tw-gap-3">
            <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Note</div>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
              Vault-relative folder paths. Nested folders supported. Empty uses defaults.
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

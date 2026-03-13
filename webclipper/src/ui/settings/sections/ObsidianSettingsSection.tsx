import type { KeyboardEvent } from 'react';

import { t } from '../../../i18n';
import { buttonClassName, cardClassName, checkboxClassName, textInputClassName } from '../ui';
import { SettingsFormRow } from './SettingsFormRow';

export function ObsidianSettingsSection(props: {
  busy: boolean;
  syncEnabled: boolean;
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
  onToggleSyncEnabled: (enabled: boolean) => void;
  onSave: () => void;
  onSaveApiKey: () => void;
  onTest: () => void;
  onOpenSetupGuide: () => void;
}) {
  const {
    busy,
    syncEnabled,
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
    onToggleSyncEnabled,
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
      <section className={cardClassName} aria-label={t('obsidianLocalRestApi')}>
        <div className="tw-flex tw-items-center tw-gap-2">
          <img className="tw-h-5 tw-w-5 tw-shrink-0" src={obsidianLogoUrl} alt="" aria-hidden="true" />
          <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('obsidianLocalRestApi')}</h2>
          <input
            id="obsidianSyncEnabledToggle"
            type="checkbox"
            className={checkboxClassName}
            checked={syncEnabled}
            disabled={busy}
            aria-label={`${t('syncTo')} ${t('providerObsidian')}`}
            onChange={(e) => onToggleSyncEnabled(e.target.checked)}
          />
        </div>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <SettingsFormRow label={t('baseUrl')}>
            <input
              value={apiBaseUrl}
              onChange={(e) => onChangeApiBaseUrl(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="http://127.0.0.1:27123"
              className={textInputClassName}
              aria-label={t('baseUrl')}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('apiKey')}>
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
              aria-label={t('apiKey')}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('authHeader')}>
            <input
              value={authHeaderName}
              onChange={(e) => onChangeAuthHeaderName(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="Authorization"
              className={textInputClassName}
              aria-label={t('authHeader')}
            />
          </SettingsFormRow>

          <SettingsFormRow label="">
            <div className="tw-flex tw-items-center tw-gap-2">
              <button className={buttonClassName} onClick={onTest} disabled={busy} type="button">
                {t('test')}
              </button>
            </div>
          </SettingsFormRow>

          <SettingsFormRow label={t('status')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{statusText}</div>
          </SettingsFormRow>

          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('obsidianInstallNote')}{' '}
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
                {t('openSetupGuide')}
              </a>
            </div>
          </SettingsFormRow>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('obsidianPaths')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('obsidianPaths')}</h2>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <SettingsFormRow label={t('aiChatsFolder')}>
            <input
              value={chatFolder}
              onChange={(e) => onChangeChatFolder(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-AIChats"
              className={textInputClassName}
              aria-label={t('aiChatsFolder')}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('webClipperFolder')}>
            <input
              value={articleFolder}
              onChange={(e) => onChangeArticleFolder(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => onEnterToSave(e)}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-WebArticles"
              className={textInputClassName}
              aria-label={t('webClipperFolder')}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('obsidianPathsNote')}
            </div>
          </SettingsFormRow>
        </div>
      </section>
    </>
  );
}

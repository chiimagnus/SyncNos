import { t } from '@i18n';
import type { KeyboardEvent } from 'react';
import { buttonClassName, cardClassName, checkboxClassName, textInputClassName } from '@ui/settings/ui';
import { SettingsFormRow } from '@ui/settings/sections/SettingsFormRow';

export function FeishuOAuthSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  feishuStatusText: string;
  feishuConnected: boolean;
  pollingFeishu: boolean;
  feishuPendingState: string;
  feishuLastError: string;
  feishuClientId: string;
  feishuClientSecret: string;
  feishuTokenExchangeProxyUrl: string;
  feishuChatFolder: string;
  feishuArticleFolder: string;
  feishuVideoFolder: string;
  setupGuideUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onConnectOrDisconnect: () => void;
  onChangeClientId: (value: string) => void;
  onChangeClientSecret: (value: string) => void;
  onChangeTokenExchangeProxyUrl: (value: string) => void;
  onChangeChatFolder: (value: string) => void;
  onChangeArticleFolder: (value: string) => void;
  onChangeVideoFolder: (value: string) => void;
  onSavePaths: () => void;
  onSaveAdvanced: () => void;
  onOpenSetupGuide: () => void;
}) {
  const {
    busy,
    syncEnabled,
    autoSyncEnabled,
    feishuStatusText,
    feishuConnected,
    pollingFeishu,
    feishuPendingState,
    feishuLastError,
    feishuClientId,
    feishuClientSecret,
    feishuTokenExchangeProxyUrl,
    feishuChatFolder,
    feishuArticleFolder,
    feishuVideoFolder,
    setupGuideUrl,
    onToggleSyncEnabled,
    onToggleAutoSyncEnabled,
    onConnectOrDisconnect,
    onChangeClientId,
    onChangeClientSecret,
    onChangeTokenExchangeProxyUrl,
    onChangeChatFolder,
    onChangeArticleFolder,
    onChangeVideoFolder,
    onSavePaths,
    onSaveAdvanced,
    onOpenSetupGuide,
  } = props;

  const onEnterToSavePaths = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSavePaths();
  };

  const onEnterToSaveAdvanced = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSaveAdvanced();
  };

  return (
    <>
      <section className={cardClassName} aria-label={t('feishuOAuth')}>
        <div className="tw-flex tw-items-center tw-gap-2">
          <div className="tw-min-w-0 tw-flex-1 tw-text-[var(--text-primary)]">
            <span className="tw-text-base tw-font-extrabold">{t('feishuOAuth')}</span>
            <span className="tw-mx-2 tw-text-[var(--text-secondary)]" aria-hidden="true">
              |
            </span>
            <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{feishuStatusText}</span>
          </div>
          <button onClick={onConnectOrDisconnect} disabled={busy} type="button" className={buttonClassName}>
            {feishuConnected ? t('disconnect') : pollingFeishu ? t('connectingDots') : t('connect')}
          </button>
        </div>

        {feishuLastError ? (
          <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">
            {t('statusError')}: {feishuLastError}
          </div>
        ) : !feishuConnected && (pollingFeishu || feishuPendingState) ? (
          <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('feishuWaitingHint')}
          </div>
        ) : null}

        <div className="tw-mt-3" aria-label={t('feishuSyncEnabledLabel')}>
          <SettingsFormRow label={t('feishuSyncEnabledLabel')}>
            <input
              id="feishuSyncEnabledToggle"
              type="checkbox"
              className={checkboxClassName}
              checked={syncEnabled}
              disabled={busy}
              aria-label={t('feishuSyncEnabledLabel')}
              onChange={(e) => onToggleSyncEnabled(e.target.checked)}
            />
          </SettingsFormRow>
        </div>

        {syncEnabled ? (
          <div className="tw-mt-3" aria-label={t('feishuAutoSyncEnabledLabel')}>
            <SettingsFormRow label={t('feishuAutoSyncEnabledLabel')}>
              <input
                id="feishuAutoSyncEnabledToggle"
                type="checkbox"
                className={checkboxClassName}
                checked={autoSyncEnabled}
                disabled={busy}
                aria-label={t('feishuAutoSyncEnabledLabel')}
                onChange={(e) => onToggleAutoSyncEnabled(e.target.checked)}
              />
            </SettingsFormRow>
          </div>
        ) : null}

        <div id="feishu-advanced-settings" className="tw-mt-3 tw-grid tw-gap-2">
          <SettingsFormRow label={t('feishuOAuthClientIdLabel')}>
            <input
              value={feishuClientId}
              onChange={(e) => onChangeClientId(e.target.value)}
              onBlur={onSaveAdvanced}
              onKeyDown={onEnterToSaveAdvanced}
              disabled={busy}
              spellCheck={false}
              placeholder="cli_xxx"
              aria-label={t('feishuOAuthClientIdLabel')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('feishuOAuthClientSecretLabel')}>
            <input
              value={feishuClientSecret}
              onChange={(e) => onChangeClientSecret(e.target.value)}
              onBlur={onSaveAdvanced}
              onKeyDown={onEnterToSaveAdvanced}
              disabled={busy}
              spellCheck={false}
              type="password"
              placeholder="••••••••"
              aria-label={t('feishuOAuthClientSecretLabel')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('feishuTokenExchangeProxyUrlLabel')}>
            <input
              value={feishuTokenExchangeProxyUrl}
              onChange={(e) => onChangeTokenExchangeProxyUrl(e.target.value)}
              onBlur={onSaveAdvanced}
              onKeyDown={onEnterToSaveAdvanced}
              disabled={busy}
              spellCheck={false}
              placeholder="https://.../feishu/oauth/exchange"
              aria-label={t('feishuTokenExchangeProxyUrlLabel')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('feishuAdvancedHint')}{' '}
              <a
                className="tw-underline hover:tw-opacity-80"
                href={setupGuideUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenSetupGuide();
                }}
              >
                {t('openSetupGuide')}
              </a>
              {t('feishuReauthorizeHint')}
            </div>
          </SettingsFormRow>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('feishuPaths')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('feishuPaths')}</h2>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <SettingsFormRow label={t('aiChatsFolder')}>
            <input
              value={feishuChatFolder}
              onChange={(e) => onChangeChatFolder(e.target.value)}
              onBlur={onSavePaths}
              onKeyDown={onEnterToSavePaths}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-AIChats"
              aria-label={t('aiChatsFolder')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('webClipperFolder')}>
            <input
              value={feishuArticleFolder}
              onChange={(e) => onChangeArticleFolder(e.target.value)}
              onBlur={onSavePaths}
              onKeyDown={onEnterToSavePaths}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-WebArticles"
              aria-label={t('webClipperFolder')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('videoScriptsFolder')}>
            <input
              value={feishuVideoFolder}
              onChange={(e) => onChangeVideoFolder(e.target.value)}
              onBlur={onSavePaths}
              onKeyDown={onEnterToSavePaths}
              disabled={busy}
              spellCheck={false}
              placeholder="SyncNos-Videos"
              aria-label={t('videoScriptsFolder')}
              className={`${textInputClassName} tw-w-full`}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('feishuPathsNote')}</div>
          </SettingsFormRow>
        </div>
      </section>
    </>
  );
}

import { t } from '@i18n';
import type { KeyboardEvent } from 'react';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import {
  buttonClassName,
  dangerButtonClassName,
  primaryButtonClassName,
  settingsTextInputClassName,
} from '@ui/settings/ui';
import { SettingsFormRow, SettingsSwitchRow } from './SettingsFormRow';
import { SettingsGroup } from './SettingsGroup';

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
  feishuClientSecretPresent: boolean;
  feishuTokenExchangeProxyUrl: string;
  feishuChatFolder: string;
  feishuArticleFolder: string;
  feishuVideoFolder: string;
  feishuLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onConnectOrDisconnect: () => void;
  onChangeClientId: (value: string) => void;
  onChangeClientSecret: (value: string) => void;
  onResetClientSecret: () => void;
  onChangeTokenExchangeProxyUrl: (value: string) => void;
  onChangeChatFolder: (value: string) => void;
  onChangeArticleFolder: (value: string) => void;
  onChangeVideoFolder: (value: string) => void;
  onSavePaths: () => void;
  onSaveAdvanced: () => void;
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
    feishuClientSecretPresent,
    feishuTokenExchangeProxyUrl,
    feishuChatFolder,
    feishuArticleFolder,
    feishuVideoFolder,
    feishuLogoUrl,
    onToggleSyncEnabled,
    onToggleAutoSyncEnabled,
    onConnectOrDisconnect,
    onChangeClientId,
    onChangeClientSecret,
    onResetClientSecret,
    onChangeTokenExchangeProxyUrl,
    onChangeChatFolder,
    onChangeArticleFolder,
    onChangeVideoFolder,
    onSavePaths,
    onSaveAdvanced,
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
      <SettingsGroup title={t('settingsAccount')} ariaLabel={t('feishuOAuth')}>
        <SettingsFormRow
          label={
            <span className="settings-account">
              <img src={feishuLogoUrl} alt="" />
              <span>
                {t('feishuOAuth')}
                <small>{feishuStatusText}</small>
              </span>
            </span>
          }
        >
          <button
            onClick={onConnectOrDisconnect}
            disabled={busy || (!feishuConnected && pollingFeishu)}
            type="button"
            className={feishuConnected ? dangerButtonClassName : primaryButtonClassName}
          >
            {feishuConnected ? t('disconnect') : pollingFeishu ? t('connectingDots') : t('connect')}
          </button>
        </SettingsFormRow>
        {feishuLastError ? (
          <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">
            {t('statusError')}: {feishuLastError}
          </div>
        ) : !feishuConnected && (pollingFeishu || feishuPendingState) ? (
          <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('feishuWaitingHint')}
          </div>
        ) : null}

        <div className="settings-group-link">
          <SettingsDocsLink path="sync/feishu" />
        </div>
      </SettingsGroup>
      <SettingsGroup title={t('settingsSync')}>
        <SettingsSwitchRow
          label={t('feishuSyncEnabledLabel')}
          id="feishuSyncEnabledToggle"
          checked={syncEnabled}
          disabled={busy}
          onChange={onToggleSyncEnabled}
          info={t('settingsSyncInfo')}
        />
        {syncEnabled ? (
          <SettingsSwitchRow
            label={t('feishuAutoSyncEnabledLabel')}
            id="feishuAutoSyncEnabledToggle"
            checked={autoSyncEnabled}
            disabled={busy}
            onChange={onToggleAutoSyncEnabled}
            dependent
            info={t('settingsAutoSyncInfo')}
          />
        ) : null}
      </SettingsGroup>
      <SettingsGroup title={t('settingsAuthorization')}>
        <div id="feishu-advanced-settings">
          <SettingsFormRow label={t('feishuOAuthClientIdLabel')}>
            <input
              value={feishuClientId}
              onChange={(e) => onChangeClientId(e.target.value)}
              onBlur={onSaveAdvanced}
              onKeyDown={onEnterToSaveAdvanced}
              disabled={busy || pollingFeishu}
              spellCheck={false}
              placeholder="cli_xxx"
              aria-label={t('feishuOAuthClientIdLabel')}
              className={settingsTextInputClassName}
            />
          </SettingsFormRow>

          <SettingsFormRow label={t('feishuOAuthClientSecretLabel')} info={t('settingsFeishuSecretInfo')}>
            <div className="tw-flex tw-w-full tw-gap-2">
              <input
                value={feishuClientSecret}
                onChange={(e) => onChangeClientSecret(e.target.value)}
                onBlur={onSaveAdvanced}
                onKeyDown={onEnterToSaveAdvanced}
                disabled={busy || pollingFeishu}
                spellCheck={false}
                type="password"
                placeholder={feishuClientSecretPresent ? '••••••••' : ''}
                aria-label={t('feishuOAuthClientSecretLabel')}
                className={settingsTextInputClassName}
              />
              {feishuClientSecretPresent ? (
                <button
                  type="button"
                  className={buttonClassName}
                  disabled={busy || pollingFeishu}
                  onClick={onResetClientSecret}
                >
                  {t('reset')}
                </button>
              ) : null}
            </div>
          </SettingsFormRow>

          <SettingsFormRow label={t('feishuTokenExchangeProxyUrlLabel')} info={t('settingsFeishuProxyInfo')}>
            <input
              value={feishuTokenExchangeProxyUrl}
              onChange={(e) => onChangeTokenExchangeProxyUrl(e.target.value)}
              onBlur={onSaveAdvanced}
              onKeyDown={onEnterToSaveAdvanced}
              disabled={busy || pollingFeishu}
              spellCheck={false}
              placeholder="https://.../feishu/oauth/exchange"
              aria-label={t('feishuTokenExchangeProxyUrlLabel')}
              className={settingsTextInputClassName}
            />
          </SettingsFormRow>
        </div>
      </SettingsGroup>
      <SettingsGroup title={t('settingsFolders')} ariaLabel={t('feishuPaths')}>
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
            className={settingsTextInputClassName}
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
            className={settingsTextInputClassName}
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
            className={settingsTextInputClassName}
          />
        </SettingsFormRow>
      </SettingsGroup>
    </>
  );
}

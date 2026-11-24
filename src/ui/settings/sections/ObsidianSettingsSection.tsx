import type { KeyboardEvent } from 'react';

import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import { buttonClassName, settingsTextInputClassName } from '@ui/settings/ui';
import { SettingsFormRow } from './SettingsFormRow';
import { SettingsSyncSection } from './SettingsSyncSection';
import { SettingsGroup } from './SettingsGroup';

export function ObsidianSettingsSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  apiBaseUrl: string;
  authHeaderName: string;
  apiKeyDraft: string;
  apiKeyPresent: boolean;
  apiKeyMasked: string;
  chatFolder: string;
  articleFolder: string;
  videoFolder: string;
  chatAttachmentFolder: string;
  articleAttachmentFolder: string;
  videoAttachmentFolder: string;
  statusText: string;
  obsidianLogoUrl: string;
  onChangeApiBaseUrl: (v: string) => void;
  onChangeAuthHeaderName: (v: string) => void;
  onChangeApiKeyDraft: (v: string) => void;
  onChangeChatFolder: (v: string) => void;
  onChangeArticleFolder: (v: string) => void;
  onChangeVideoFolder: (v: string) => void;
  onChangeChatAttachmentFolder: (v: string) => void;
  onChangeArticleAttachmentFolder: (v: string) => void;
  onChangeVideoAttachmentFolder: (v: string) => void;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onSave: () => void;
  onSaveApiKey: () => void;
  onTest: () => void;
}) {
  const {
    busy,
    syncEnabled,
    autoSyncEnabled,
    apiBaseUrl,
    authHeaderName,
    apiKeyDraft,
    apiKeyPresent,
    apiKeyMasked,
    chatFolder,
    articleFolder,
    videoFolder,
    chatAttachmentFolder,
    articleAttachmentFolder,
    videoAttachmentFolder,
    statusText,
    obsidianLogoUrl,
    onChangeApiBaseUrl,
    onChangeAuthHeaderName,
    onChangeApiKeyDraft,
    onChangeChatFolder,
    onChangeArticleFolder,
    onChangeVideoFolder,
    onChangeChatAttachmentFolder,
    onChangeArticleAttachmentFolder,
    onChangeVideoAttachmentFolder,
    onToggleSyncEnabled,
    onToggleAutoSyncEnabled,
    onSave,
    onSaveApiKey,
    onTest,
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
    <SettingsSyncSection
      provider="obsidian"
      busy={busy}
      syncEnabled={syncEnabled}
      autoSyncEnabled={autoSyncEnabled}
      onToggleSyncEnabled={onToggleSyncEnabled}
      onToggleAutoSyncEnabled={onToggleAutoSyncEnabled}
    >
      <SettingsGroup title={t('settingsAccount')} ariaLabel={t('obsidianLocalRestApi')}>
        <SettingsFormRow
          label={
            <span className="settings-account">
              <img src={obsidianLogoUrl} alt="" />
              <span>
                {t('obsidianLocalRestApi')}
                <small>{statusText}</small>
              </span>
            </span>
          }
        >
          <button className={buttonClassName} onClick={onTest} disabled={busy} type="button">
            {t('test')}
          </button>
        </SettingsFormRow>
        <div className="settings-group-link">
          <SettingsDocsLink path="sync/obsidian" />
        </div>
      </SettingsGroup>
      <SettingsGroup title={t('settingsAuthorization')}>
        <SettingsFormRow label={t('baseUrl')} info={t('settingsObsidianUrlInfo')}>
          <input
            value={apiBaseUrl}
            onChange={(e) => onChangeApiBaseUrl(e.target.value)}
            onBlur={onSave}
            onKeyDown={(e) => onEnterToSave(e)}
            disabled={busy}
            spellCheck={false}
            placeholder="http://127.0.0.1:27123"
            className={settingsTextInputClassName}
            aria-label={t('baseUrl')}
          />
        </SettingsFormRow>

        <SettingsFormRow label={t('apiKey')}>
          <input
            type="password"
            value={apiKeyDraft}
            onChange={(e) => onChangeApiKeyDraft(e.target.value)}
            onBlur={() => {
              if (!String(apiKeyDraft || '').trim()) return;
              onSaveApiKey();
            }}
            onKeyDown={(e) => onEnterToSave(e, 'apiKey')}
            disabled={busy}
            placeholder={apiKeyPresent ? apiKeyMasked : ''}
            className={settingsTextInputClassName}
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
            className={settingsTextInputClassName}
            aria-label={t('authHeader')}
          />
        </SettingsFormRow>
      </SettingsGroup>
      <SettingsGroup
        title={t('settingsFolders')}
        ariaLabel={t('obsidianPaths')}
        note={t('obsidianAttachmentFolderHelp')}
      >
        {[
          {
            label: t('aiChatsFolder'),
            folder: chatFolder,
            attachmentFolder: chatAttachmentFolder,
            onChangeFolder: onChangeChatFolder,
            onChangeAttachment: onChangeChatAttachmentFolder,
          },
          {
            label: t('webClipperFolder'),
            folder: articleFolder,
            attachmentFolder: articleAttachmentFolder,
            onChangeFolder: onChangeArticleFolder,
            onChangeAttachment: onChangeArticleAttachmentFolder,
          },
          {
            label: t('videoScriptsFolder'),
            folder: videoFolder,
            attachmentFolder: videoAttachmentFolder,
            onChangeFolder: onChangeVideoFolder,
            onChangeAttachment: onChangeVideoAttachmentFolder,
          },
        ].map(({ label, folder, attachmentFolder, onChangeFolder, onChangeAttachment }) => (
          <div className="settings-path-pair" key={label}>
            <SettingsFormRow label={label}>
              <input
                value={folder}
                onChange={(e) => onChangeFolder(e.target.value)}
                onBlur={onSave}
                onKeyDown={(e) => onEnterToSave(e)}
                disabled={busy}
                spellCheck={false}
                className={settingsTextInputClassName}
                aria-label={label}
              />
            </SettingsFormRow>
            <SettingsFormRow label={t('obsidianAttachmentFolder')} dependent>
              <input
                value={attachmentFolder === '.' ? '' : attachmentFolder}
                onChange={(e) => onChangeAttachment(e.target.value)}
                onBlur={onSave}
                onKeyDown={(e) => onEnterToSave(e)}
                disabled={busy}
                spellCheck={false}
                placeholder={folder}
                className={settingsTextInputClassName}
                aria-label={label + ' · ' + t('obsidianAttachmentFolder')}
              />
            </SettingsFormRow>
          </div>
        ))}
      </SettingsGroup>
    </SettingsSyncSection>
  );
}

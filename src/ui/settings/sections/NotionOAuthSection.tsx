import type { NotionPageOption } from '@viewmodels/settings/utils';
import { useState, type KeyboardEvent } from 'react';
import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import {
  buttonClassName,
  dangerButtonClassName,
  primaryButtonClassName,
  settingsControlWidthClassName,
  settingsTextInputClassName,
} from '@ui/settings/ui';
import { SettingsFormRow } from './SettingsFormRow';
import { SettingsSyncSection } from './SettingsSyncSection';
import { SettingsGroup } from './SettingsGroup';
import { SelectMenu } from '@ui/shared/SelectMenu';

export function NotionOAuthSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  notionStatusText: string;
  notionConnected: boolean;
  pollingNotion: boolean;
  loadingNotionPages: boolean;
  notionAdvancedOpen: boolean;
  notionParentPageId: string;
  notionChatDatabaseId: string;
  notionArticleDatabaseId: string;
  notionVideoDatabaseId: string;
  notionChatDatabaseLabel: string;
  notionArticleDatabaseLabel: string;
  notionVideoDatabaseLabel: string;
  notionPageOptions: NotionPageOption[];
  notionPageSearchEmpty: boolean;
  notionLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onToggleAdvancedOpen: () => void;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => Promise<boolean>;
  onChangeNotionChatDatabaseId: (id: string) => void;
  onChangeNotionArticleDatabaseId: (id: string) => void;
  onChangeNotionVideoDatabaseId: (id: string) => void;
  onSaveNotionDatabaseId: (kind: 'chat' | 'article' | 'video') => void;
  onResetNotionDatabaseId: (kind: 'chat' | 'article' | 'video') => void;
  onLoadNotionPages: () => void;
}) {
  const {
    busy,
    syncEnabled,
    autoSyncEnabled,
    notionStatusText,
    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAdvancedOpen,
    notionParentPageId,
    notionChatDatabaseId,
    notionArticleDatabaseId,
    notionVideoDatabaseId,
    notionChatDatabaseLabel,
    notionArticleDatabaseLabel,
    notionVideoDatabaseLabel,
    notionPageOptions,
    notionPageSearchEmpty,
    notionLogoUrl,
    onToggleSyncEnabled,
    onToggleAutoSyncEnabled,
    onToggleAdvancedOpen,
    onConnectOrDisconnect,
    onSaveNotionParentPage,
    onChangeNotionChatDatabaseId,
    onChangeNotionArticleDatabaseId,
    onChangeNotionVideoDatabaseId,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    onLoadNotionPages,
  } = props;

  const [parentPageInput, setParentPageInput] = useState('');
  const saveParentPageInput = async () => {
    if (await onSaveNotionParentPage(parentPageInput)) setParentPageInput('');
  };

  const onEnterToSaveDatabaseId = (e: KeyboardEvent<HTMLInputElement>, kind: 'chat' | 'article' | 'video') => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSaveNotionDatabaseId(kind);
  };

  return (
    <SettingsSyncSection
      provider="notion"
      busy={busy}
      syncEnabled={syncEnabled}
      autoSyncEnabled={autoSyncEnabled}
      onToggleSyncEnabled={onToggleSyncEnabled}
      onToggleAutoSyncEnabled={onToggleAutoSyncEnabled}
    >
      <SettingsGroup title={t('settingsAccount')} ariaLabel={t('notionOAuth')}>
        <SettingsFormRow
          label={
            <span className="settings-account">
              <img className="webclipper-provider-logo--invert-in-dark" src={notionLogoUrl} alt="" />
              <span>
                {t('notionOAuth')}
                <small>{notionStatusText}</small>
              </span>
            </span>
          }
        >
          <button
            onClick={onConnectOrDisconnect}
            disabled={busy || (!notionConnected && pollingNotion)}
            type="button"
            className={notionConnected ? dangerButtonClassName : primaryButtonClassName}
          >
            {notionConnected ? t('disconnect') : pollingNotion ? t('connectingDots') : t('connect')}
          </button>
        </SettingsFormRow>
        <div className="settings-group-link">
          <SettingsDocsLink path="sync/notion" />
        </div>
      </SettingsGroup>
      <SettingsGroup title={t('settingsDestination')}>
        <SettingsFormRow
          label={t('parentPage')}
          info={t('settingsNotionDestinationInfo')}
          description={
            notionConnected && !loadingNotionPages && !notionParentPageId && notionPageSearchEmpty
              ? t('notionNoParentPages')
              : undefined
          }
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <SelectMenu<string>
              buttonId="notionPages"
              className={`${settingsControlWidthClassName} tw-min-w-0`}
              buttonClassName={`${buttonClassName} tw-w-full`}
              value={String(notionParentPageId || '')}
              disabled={busy || !notionConnected || loadingNotionPages}
              ariaLabel={t('parentPage')}
              minWidth={180}
              maxHeight={320}
              onChange={(next) => void onSaveNotionParentPage(next)}
              options={[
                {
                  value: '',
                  label: notionConnected ? t('parentPage') : t('connectNotionFirst'),
                  disabled: true,
                },
                ...notionPageOptions.map((p) => ({
                  value: p.id,
                  label: p.title,
                })),
              ]}
            />
            <button
              type="button"
              title={t('refresh')}
              onClick={onLoadNotionPages}
              disabled={busy || !notionConnected || loadingNotionPages}
              className="webclipper-btn webclipper-btn--icon"
              aria-label={t('refreshPagesAria')}
              aria-busy={loadingNotionPages}
            >
              {loadingNotionPages ? '⏳' : '↻'}
            </button>
          </div>
        </SettingsFormRow>
        {notionConnected ? (
          <SettingsFormRow label={t('notionParentPageLink')} controlId="notionParentPageLink">
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
              <input
                id="notionParentPageLink"
                value={parentPageInput}
                onChange={(e) => setParentPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !parentPageInput.trim() || busy || loadingNotionPages) return;
                  e.preventDefault();
                  void saveParentPageInput();
                }}
                disabled={busy || loadingNotionPages}
                spellCheck={false}
                placeholder="https://www.notion.so/…"
                className={settingsTextInputClassName}
              />
              <button
                type="button"
                className={buttonClassName}
                onClick={() => void saveParentPageInput()}
                disabled={busy || loadingNotionPages || !parentPageInput.trim()}
              >
                {t('saveButton')}
              </button>
            </div>
          </SettingsFormRow>
        ) : null}
        <SettingsFormRow label={t('settingsAdvanced')} info={t('notionAdvancedDbIdHint')}>
          <button
            type="button"
            className={buttonClassName}
            onClick={onToggleAdvancedOpen}
            disabled={busy || !notionConnected}
            aria-expanded={notionAdvancedOpen}
            aria-controls="notion-advanced-settings"
          >
            {notionAdvancedOpen ? t('advancedHide') : t('advancedShow')}
          </button>
        </SettingsFormRow>
        {notionAdvancedOpen ? (
          <div id="notion-advanced-settings" className="settings-expanded">
            <SettingsFormRow label={t('notionDbIdAiChats')}>
              <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                <input
                  value={notionChatDatabaseId}
                  onChange={(e) => onChangeNotionChatDatabaseId(e.target.value)}
                  onBlur={() => onSaveNotionDatabaseId('chat')}
                  onKeyDown={(e) => onEnterToSaveDatabaseId(e, 'chat')}
                  disabled={busy || !notionConnected}
                  spellCheck={false}
                  placeholder={notionChatDatabaseLabel}
                  aria-label={t('notionDbIdAiChats')}
                  className={settingsTextInputClassName}
                />
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => onResetNotionDatabaseId('chat')}
                  disabled={busy || !notionConnected}
                >
                  {t('reset')}
                </button>
              </div>
            </SettingsFormRow>

            <SettingsFormRow label={t('notionDbIdWebArticles')}>
              <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                <input
                  value={notionArticleDatabaseId}
                  onChange={(e) => onChangeNotionArticleDatabaseId(e.target.value)}
                  onBlur={() => onSaveNotionDatabaseId('article')}
                  onKeyDown={(e) => onEnterToSaveDatabaseId(e, 'article')}
                  disabled={busy || !notionConnected}
                  spellCheck={false}
                  placeholder={notionArticleDatabaseLabel}
                  aria-label={t('notionDbIdWebArticles')}
                  className={settingsTextInputClassName}
                />
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => onResetNotionDatabaseId('article')}
                  disabled={busy || !notionConnected}
                >
                  {t('reset')}
                </button>
              </div>
            </SettingsFormRow>

            <SettingsFormRow label={t('notionDbIdVideos')}>
              <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                <input
                  value={notionVideoDatabaseId}
                  onChange={(e) => onChangeNotionVideoDatabaseId(e.target.value)}
                  onBlur={() => onSaveNotionDatabaseId('video')}
                  onKeyDown={(e) => onEnterToSaveDatabaseId(e, 'video')}
                  disabled={busy || !notionConnected}
                  spellCheck={false}
                  placeholder={notionVideoDatabaseLabel}
                  aria-label={t('notionDbIdVideos')}
                  className={settingsTextInputClassName}
                />
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => onResetNotionDatabaseId('video')}
                  disabled={busy || !notionConnected}
                >
                  {t('reset')}
                </button>
              </div>
            </SettingsFormRow>
          </div>
        ) : null}
      </SettingsGroup>
    </SettingsSyncSection>
  );
}

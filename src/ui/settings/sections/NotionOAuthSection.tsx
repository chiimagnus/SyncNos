import type { NotionPageOption } from '@viewmodels/settings/utils';
import { useEffect, useState, type KeyboardEvent } from 'react';
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
  onClearError: () => void;
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
    onClearError,
    onSaveNotionParentPage,
    onChangeNotionChatDatabaseId,
    onChangeNotionArticleDatabaseId,
    onChangeNotionVideoDatabaseId,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    onLoadNotionPages,
  } = props;

  const [parentPageInput, setParentPageInput] = useState<string | null>(null);
  const selectingByLink = notionConnected && parentPageInput !== null;
  const linkOption = '__notion_page_link__';
  const pageSelectionDisabled = busy || !notionConnected || loadingNotionPages;
  useEffect(() => {
    if (!notionConnected || !syncEnabled) setParentPageInput(null);
  }, [notionConnected, syncEnabled]);

  const closePageInput = () => {
    onClearError();
    setParentPageInput(null);
    window.requestAnimationFrame(() => document.getElementById('notionPages')?.focus());
  };
  const saveParentPageInput = async () => {
    if (parentPageInput?.trim() && (await onSaveNotionParentPage(parentPageInput))) closePageInput();
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
            selectingByLink
              ? t('notionParentPageLinkHint')
              : notionConnected && !loadingNotionPages && !notionParentPageId && notionPageSearchEmpty
                ? t('notionNoParentPages')
                : undefined
          }
        >
          {selectingByLink ? (
            <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-end tw-gap-2">
              <input
                id="notionParentPageLink"
                aria-label={t('notionParentPageLink')}
                autoFocus
                value={parentPageInput}
                onInput={(e) => setParentPageInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !busy) {
                    e.preventDefault();
                    e.stopPropagation();
                    closePageInput();
                  } else if (e.key === 'Enter' && parentPageInput.trim() && !pageSelectionDisabled) {
                    e.preventDefault();
                    void saveParentPageInput();
                  }
                }}
                disabled={pageSelectionDisabled}
                spellCheck={false}
                placeholder={t('notionParentPageLink')}
                className={settingsTextInputClassName}
              />
              <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
                <button type="button" className={buttonClassName} onClick={closePageInput} disabled={busy}>
                  {t('cancelButton')}
                </button>
                <button
                  type="button"
                  className={primaryButtonClassName}
                  onClick={() => void saveParentPageInput()}
                  disabled={pageSelectionDisabled || !parentPageInput.trim()}
                >
                  {t('saveButton')}
                </button>
              </div>
            </div>
          ) : (
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
              <SelectMenu<string>
                buttonId="notionPages"
                className={`${settingsControlWidthClassName} tw-min-w-0`}
                buttonClassName={`${buttonClassName} tw-w-full`}
                value={String(notionParentPageId || '')}
                disabled={pageSelectionDisabled}
                ariaLabel={t('parentPage')}
                minWidth={180}
                maxHeight={320}
                onChange={(next) => {
                  if (next === linkOption) setParentPageInput('');
                  else void onSaveNotionParentPage(next);
                }}
                options={[
                  {
                    value: '',
                    label: !notionConnected
                      ? t('connectNotionFirst')
                      : loadingNotionPages
                        ? t('loadingDots')
                        : t('notionChooseParentPage'),
                    disabled: true,
                  },
                  ...notionPageOptions.map((p) => ({
                    value: p.id,
                    label: p.title,
                  })),
                  { value: linkOption, label: t('notionChoosePageByLink') },
                ]}
              />
              <button
                type="button"
                title={t('refresh')}
                onClick={onLoadNotionPages}
                disabled={pageSelectionDisabled}
                className="webclipper-btn webclipper-btn--icon"
                aria-label={t('refreshPagesAria')}
                aria-busy={loadingNotionPages}
              >
                {loadingNotionPages ? '⏳' : '↻'}
              </button>
            </div>
          )}
        </SettingsFormRow>
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

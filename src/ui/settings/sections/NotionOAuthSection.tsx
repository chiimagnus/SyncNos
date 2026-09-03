import type { NotionPageOption } from '@viewmodels/settings/utils';
import type { KeyboardEvent } from 'react';
import { t } from '@i18n';
import { buttonClassName, cardClassName, checkboxClassName, textInputClassName } from '@ui/settings/ui';
import { SettingsFormRow } from '@ui/settings/sections/SettingsFormRow';
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
  notionLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onToggleAdvancedOpen: () => void;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => void;
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

  const onEnterToSaveDatabaseId = (e: KeyboardEvent<HTMLInputElement>, kind: 'chat' | 'article' | 'video') => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSaveNotionDatabaseId(kind);
  };

  return (
    <section className={cardClassName} aria-label={t('notionOAuth')}>
      <div className="tw-flex tw-items-center tw-gap-2">
        <img
          className="webclipper-provider-logo--invert-in-dark tw-h-5 tw-w-5 tw-shrink-0"
          src={notionLogoUrl}
          alt=""
          aria-hidden="true"
        />
        <div className="tw-min-w-0 tw-flex-1 tw-text-[var(--text-primary)]">
          <span className="tw-text-base tw-font-extrabold">{t('notionOAuth')}</span>
          <span className="tw-mx-2 tw-text-[var(--text-secondary)]" aria-hidden="true">
            |
          </span>
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{notionStatusText}</span>
        </div>
        <button
          onClick={onConnectOrDisconnect}
          disabled={busy || (!notionConnected && pollingNotion)}
          type="button"
          className={buttonClassName}
        >
          {notionConnected ? t('disconnect') : pollingNotion ? t('connectingDots') : t('connect')}
        </button>
      </div>

      <div className="tw-mt-3" aria-label={t('notionSyncEnabledLabel')}>
        <SettingsFormRow label={t('notionSyncEnabledLabel')}>
          <input
            id="notionSyncEnabledToggle"
            type="checkbox"
            className={checkboxClassName}
            checked={syncEnabled}
            disabled={busy}
            aria-label={t('notionSyncEnabledLabel')}
            onChange={(e) => onToggleSyncEnabled(e.target.checked)}
          />
        </SettingsFormRow>
      </div>

      {syncEnabled ? (
        <div className="tw-mt-3" aria-label={t('notionAutoSyncEnabledLabel')}>
          <SettingsFormRow label={t('notionAutoSyncEnabledLabel')}>
            <input
              id="notionAutoSyncEnabledToggle"
              type="checkbox"
              className={checkboxClassName}
              checked={autoSyncEnabled}
              disabled={busy}
              aria-label={t('notionAutoSyncEnabledLabel')}
              onChange={(e) => onToggleAutoSyncEnabled(e.target.checked)}
            />
          </SettingsFormRow>
        </div>
      ) : null}

      <div className="tw-mt-3" aria-label={t('parentPage')}>
        <SettingsFormRow label={t('parentPage')}>
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <SelectMenu<string>
              buttonId="notionPages"
              className="tw-flex-1 tw-min-w-0"
              buttonClassName={`${buttonClassName} tw-w-full`}
              value={String(notionParentPageId || '')}
              disabled={busy || !notionConnected || loadingNotionPages}
              ariaLabel={t('parentPage')}
              maxHeight={320}
              onChange={(next) => onSaveNotionParentPage(next)}
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
      </div>

      <div className="tw-mt-3">
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
      </div>

      {notionAdvancedOpen ? (
        <div id="notion-advanced-settings" className="tw-mt-3 tw-grid tw-gap-2">
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
                className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
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
                className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
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
                className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
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

          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('notionAdvancedDbIdHint')}
            </div>
          </SettingsFormRow>
        </div>
      ) : null}
    </section>
  );
}

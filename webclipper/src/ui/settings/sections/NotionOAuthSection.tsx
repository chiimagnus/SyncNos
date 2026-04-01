import type { NotionPageOption } from '@viewmodels/settings/utils';
import { t } from '@i18n';
import { buttonClassName, cardClassName, checkboxClassName, textInputClassName } from '@ui/settings/ui';
import { SettingsFormRow } from '@ui/settings/sections/SettingsFormRow';
import { SelectMenu } from '@ui/shared/SelectMenu';

export function NotionOAuthSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  notionStatusText: string;
  notionConnected: boolean;
  pollingNotion: boolean;
  loadingNotionPages: boolean;
  notionAdvancedOpen: boolean;
  notionParentPageId: string;
  notionChatDatabaseId: string;
  notionArticleDatabaseId: string;
  notionChatDatabaseLabel: string;
  notionArticleDatabaseLabel: string;
  notionPageOptions: NotionPageOption[];
  notionLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAdvancedOpen: () => void;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => void;
  onChangeNotionChatDatabaseId: (id: string) => void;
  onChangeNotionArticleDatabaseId: (id: string) => void;
  onSaveNotionDatabaseId: (kind: 'chat' | 'article') => void;
  onResetNotionDatabaseId: (kind: 'chat' | 'article') => void;
  onLoadNotionPages: () => void;
}) {
  const {
    busy,
    syncEnabled,
    notionStatusText,
    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAdvancedOpen,
    notionParentPageId,
    notionChatDatabaseId,
    notionArticleDatabaseId,
    notionChatDatabaseLabel,
    notionArticleDatabaseLabel,
    notionPageOptions,
    notionLogoUrl,
    onToggleSyncEnabled,
    onToggleAdvancedOpen,
    onConnectOrDisconnect,
    onSaveNotionParentPage,
    onChangeNotionChatDatabaseId,
    onChangeNotionArticleDatabaseId,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    onLoadNotionPages,
  } = props;

  return (
    <section className={cardClassName} aria-label={t('notionOAuth')}>
      <div className="tw-flex tw-items-center tw-gap-2">
        <img className="tw-h-5 tw-w-5 tw-shrink-0" src={notionLogoUrl} alt="" aria-hidden="true" />
        <div className="tw-min-w-0 tw-flex-1 tw-text-[var(--text-primary)]">
          <span className="tw-text-base tw-font-extrabold">{t('notionOAuth')}</span>
          <span className="tw-mx-2 tw-text-[var(--text-secondary)]" aria-hidden="true">
            |
          </span>
          <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{notionStatusText}</span>
        </div>
        <button onClick={onConnectOrDisconnect} disabled={busy} type="button" className={buttonClassName}>
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
        {!syncEnabled ? (
          <div className="tw-mt-2">
            <SettingsFormRow label="" align="start">
              <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                {t('notionSyncEnabledHint')}
              </div>
            </SettingsFormRow>
          </div>
        ) : null}
      </div>

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
                disabled={busy || !notionConnected}
                spellCheck={false}
                placeholder={notionChatDatabaseLabel}
                aria-label={t('notionDbIdAiChats')}
                className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
              />
              <button
                type="button"
                className={buttonClassName}
                onClick={() => onSaveNotionDatabaseId('chat')}
                disabled={busy || !notionConnected}
              >
                {t('save')}
              </button>
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
                disabled={busy || !notionConnected}
                spellCheck={false}
                placeholder={notionArticleDatabaseLabel}
                aria-label={t('notionDbIdWebArticles')}
                className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
              />
              <button
                type="button"
                className={buttonClassName}
                onClick={() => onSaveNotionDatabaseId('article')}
                disabled={busy || !notionConnected}
              >
                {t('save')}
              </button>
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

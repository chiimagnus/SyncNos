import type { NotionPageOption } from '../utils';
import { t } from '../../../i18n';
import { buttonClassName, cardClassName, checkboxClassName } from '../ui';
import { SettingsFormRow } from './SettingsFormRow';
import { SelectMenu } from '../../shared/SelectMenu';

export function NotionOAuthSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  notionStatusText: string;
  notionConnected: boolean;
  pollingNotion: boolean;
  loadingNotionPages: boolean;
  notionParentPageId: string;
  notionPageOptions: NotionPageOption[];
  notionLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onConnectOrDisconnect: () => void;
  onSaveNotionParentPage: (id: string) => void;
  onLoadNotionPages: () => void;
}) {
  const {
    busy,
    syncEnabled,
    notionStatusText,
    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionParentPageId,
    notionPageOptions,
    notionLogoUrl,
    onToggleSyncEnabled,
    onConnectOrDisconnect,
    onSaveNotionParentPage,
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
              <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('notionSyncEnabledHint')}</div>
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
              disabled={busy || !notionConnected}
              ariaLabel={t('parentPage')}
              maxHeight={320}
              onChange={(next) => onSaveNotionParentPage(next)}
              options={[
                {
                  value: '',
                  label: notionConnected
                    ? notionPageOptions.length
                      ? t('parentPage')
                      : t('clickRefresh')
                    : t('connectNotionFirst'),
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
            >
              ↻
            </button>
          </div>
        </SettingsFormRow>
      </div>
    </section>
  );
}

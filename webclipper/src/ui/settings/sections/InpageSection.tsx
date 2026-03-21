import { t } from '../../../i18n';
import { SUPPORTED_AI_CHAT_SITES } from '../../../collectors/ai-chat-sites';
import { cardClassName, checkboxClassName } from '../ui';
import { buttonTintClassName } from '../../shared/button-styles';
import { SelectMenu } from '../../shared/SelectMenu';

type InpageDisplayMode = 'supported' | 'all' | 'off';

export function InpageSection(props: {
  busy: boolean;
  displayMode: InpageDisplayMode;
  onChangeDisplayMode: (next: InpageDisplayMode) => void;
  aiChatAutoSaveEnabled: boolean;
  onToggleAiChatAutoSaveEnabled: (next: boolean) => void;
  aiChatCacheImagesEnabled: boolean;
  onToggleAiChatCacheImagesEnabled: (next: boolean) => void;
  }) {
  const {
    busy,
    displayMode,
    onChangeDisplayMode,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
  } = props;

  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('inpageButtonHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('inpageButtonHeading')}</h2>
        <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <label className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('inpageDisplayModeLabel')}</label>
            <SelectMenu<InpageDisplayMode>
              value={displayMode}
              onChange={onChangeDisplayMode}
              disabled={busy}
              ariaLabel={t('inpageDisplayModeLabel')}
              minWidth={180}
              buttonClassName={[buttonTintClassName(), 'tw-min-w-[180px]'].join(' ')}
              options={[
                { value: 'supported', label: t('inpageDisplayModeSupported') },
                { value: 'all', label: t('inpageDisplayModeAll') },
                { value: 'off', label: t('inpageDisplayModeOff') },
              ]}
            />
          </div>
          <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">{t('inpageDisplayModeHint')}</div>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('aiChatAutoSaveHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('aiChatAutoSaveHeading')}</h2>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={aiChatAutoSaveEnabled}
            disabled={busy}
            onChange={(e) => onToggleAiChatAutoSaveEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('aiChatAutoSaveLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatAutoSaveHint')}
        </div>

        <label className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={aiChatCacheImagesEnabled}
            disabled={busy}
            onChange={(e) => onToggleAiChatCacheImagesEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          <span className="tw-inline-flex tw-items-center tw-gap-2">
            <span>{t('aiChatCacheImagesLabel')}</span>
            <span className="tw-inline-flex tw-items-center tw-rounded-md tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-black tw-tracking-wide tw-text-[var(--text-secondary)]">
              {t('betaTag')}
            </span>
          </span>
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatCacheImagesHint')}
        </div>

        <div className="tw-mt-2.5 tw-grid tw-gap-2">
          {SUPPORTED_AI_CHAT_SITES.map((site) => {
            const hosts = Array.isArray(site.hosts) ? site.hosts.filter(Boolean) : [];
            const hostLabel = hosts.length ? hosts.join(' / ') : site.id;
            return (
              <div
                key={site.id}
                className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-3 tw-py-2"
              >
                <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{site.name}</div>
                <div className="tw-truncate tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{hostLabel}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

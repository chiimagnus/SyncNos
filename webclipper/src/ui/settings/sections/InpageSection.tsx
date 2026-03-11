import { t } from '../../../i18n';
import { SUPPORTED_AI_CHAT_SITES } from '../../../collectors/ai-chat-sites';
import { cardClassName, checkboxClassName, selectClassName } from '../ui';

type InpageDisplayMode = 'supported' | 'all' | 'off';

export function InpageSection(props: {
  busy: boolean;
  themeMode: 'system' | 'light' | 'dark';
  onChangeThemeMode: (next: 'system' | 'light' | 'dark') => void;
  displayMode: InpageDisplayMode;
  onChangeDisplayMode: (next: InpageDisplayMode) => void;
  aiChatAutoSaveEnabled: boolean;
  onToggleAiChatAutoSaveEnabled: (next: boolean) => void;
}) {
  const { busy, themeMode, onChangeThemeMode, displayMode, onChangeDisplayMode, aiChatAutoSaveEnabled, onToggleAiChatAutoSaveEnabled } = props;

  const themeModeButtonClassName = (active: boolean) =>
    [
      'tw-inline-flex tw-min-h-8 tw-items-center tw-justify-center tw-rounded-lg tw-px-3 tw-text-xs tw-font-extrabold',
      'tw-transition-colors tw-duration-150',
      'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
      'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
      active
        ? 'tw-bg-[var(--accent)] tw-text-[var(--accent-foreground)]'
        : 'tw-bg-transparent tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-card)] hover:tw-text-[var(--text-primary)]',
    ].join(' ');

  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('appearanceHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('appearanceHeading')}</h2>
        <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <label className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('themeModeLabel')}</label>
            <div
              role="group"
              aria-label={t('themeModeLabel')}
              className="tw-inline-flex tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-1"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeThemeMode('system')}
                className={themeModeButtonClassName(themeMode === 'system')}
                aria-pressed={themeMode === 'system'}
              >
                {t('themeModeSystem')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeThemeMode('light')}
                className={themeModeButtonClassName(themeMode === 'light')}
                aria-pressed={themeMode === 'light'}
              >
                {t('themeModeLight')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeThemeMode('dark')}
                className={themeModeButtonClassName(themeMode === 'dark')}
                aria-pressed={themeMode === 'dark'}
              >
                {t('themeModeDark')}
              </button>
            </div>
          </div>
          <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">{t('themeModeHint')}</div>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('inpageButtonHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('inpageButtonHeading')}</h2>
        <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <label className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('inpageDisplayModeLabel')}</label>
            <select
              value={displayMode}
              disabled={busy}
              onChange={(e) => onChangeDisplayMode(e.target.value as InpageDisplayMode)}
              className={`${selectClassName} tw-min-w-[180px]`}
            >
              <option value="supported">{t('inpageDisplayModeSupported')}</option>
              <option value="all">{t('inpageDisplayModeAll')}</option>
              <option value="off">{t('inpageDisplayModeOff')}</option>
            </select>
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

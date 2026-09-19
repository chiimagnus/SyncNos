import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';
import { APP_THEME_MODES, type AppThemeMode } from '@services/protocols/app-theme';
import { t } from '@i18n';

export type ThemePanelProps = {
  mode: AppThemeMode;
  update: (mode: AppThemeMode) => void | Promise<void>;
  className?: string;
};

export function ThemePanel({ mode, update, className }: ThemePanelProps) {
  const themeLabels: Record<AppThemeMode, string> = {
    system: t('readerThemeSystem'),
    light: t('readerThemeLight'),
    sepia: t('readerThemeSepia'),
    dark: t('readerThemeDark'),
    black: t('readerThemeBlack'),
  };
  const selectTheme = (themeMode: AppThemeMode) => {
    if (themeMode === mode) return;
    void update(themeMode);
  };

  return (
    <div className={['tw-flex tw-flex-col tw-gap-1.5', className].filter(Boolean).join(' ')}>
      <div className="tw-flex tw-flex-wrap tw-gap-1.5" role="radiogroup" aria-label={t('readerThemeAria')}>
        {APP_THEME_MODES.map((themeMode) => {
          const active = themeMode === mode;
          return (
            <button
              key={themeMode}
              type="button"
              role="radio"
              aria-checked={active}
              className={[active ? buttonFilledClassName() : buttonTintClassName(), 'tw-flex-1'].join(' ')}
              onClick={() => selectTheme(themeMode)}
            >
              {themeLabels[themeMode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

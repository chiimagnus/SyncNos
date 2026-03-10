import { t } from '../../../i18n';
import { cardClassName, selectClassName } from '../ui';

type InpageDisplayMode = 'supported' | 'all' | 'off';

export function InpageSection(props: {
  busy: boolean;
  displayMode: InpageDisplayMode;
  onChangeDisplayMode: (next: InpageDisplayMode) => void;
}) {
  const { busy, displayMode, onChangeDisplayMode } = props;
  return (
    <section className={cardClassName} aria-label={t('inpageButtonHeading')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">{t('inpageButtonHeading')}</h2>
      <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
        <label className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">{t('inpageDisplayModeLabel')}</label>
        <select
          value={displayMode}
          disabled={busy}
          onChange={(e) => onChangeDisplayMode(e.target.value as InpageDisplayMode)}
          className={selectClassName}
        >
          <option value="supported">{t('inpageDisplayModeSupported')}</option>
          <option value="all">{t('inpageDisplayModeAll')}</option>
          <option value="off">{t('inpageDisplayModeOff')}</option>
        </select>
        <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{t('inpageDisplayModeHint')}</div>
      </div>
    </section>
  );
}

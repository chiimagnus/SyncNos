import { t } from '../../../i18n';
import { cardClassName, checkboxClassName } from '../ui';

export function InpageSection(props: { busy: boolean; supportedOnly: boolean; onToggleSupportedOnly: (next: boolean) => void }) {
  const { busy, supportedOnly, onToggleSupportedOnly } = props;
  return (
    <section className={cardClassName} aria-label={t('inpageButtonHeading')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">{t('inpageButtonHeading')}</h2>
      <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">
        <input
          type="checkbox"
          checked={supportedOnly}
          disabled={busy}
          onChange={(e) => onToggleSupportedOnly(!!e.target.checked)}
          className={checkboxClassName}
        />
        {t('inpageSupportedOnlyLabel')}
      </label>
      <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">
        {t('inpageSupportedOnlyHint')}
      </div>
    </section>
  );
}

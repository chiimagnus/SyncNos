import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { getCurrentLocale, t } from '@i18n';
import { buildSettingsDocsUrl, type SettingsDocsPath } from '@ui/settings/SettingsDocsLink';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

function SettingsInfo({ label, detail, docsPath }: { label: string; detail: string; docsPath?: SettingsDocsPath }) {
  const icon = <Info size={16} aria-hidden="true" />;
  if (docsPath) {
    return (
      <a
        className="settings-info"
        href={buildSettingsDocsUrl(docsPath, getCurrentLocale())}
        target="_blank"
        rel="noreferrer"
        aria-label={t('settingsDocsLink') + ': ' + label}
        {...tooltipAttrs(detail + '\n' + t('settingsDocsLink') + ' ↗', 'bottom-start')}
      >
        {icon}
      </a>
    );
  }
  return (
    <span
      className="settings-info"
      role="img"
      tabIndex={0}
      aria-label={detail}
      {...tooltipAttrs(detail, 'bottom-start')}
    >
      {icon}
    </span>
  );
}

export function SettingsFormRow({
  label,
  align = 'center',
  description,
  info,
  docsPath,
  badge,
  dependent,
  children,
  controlId,
}: {
  label: ReactNode;
  align?: 'center' | 'start';
  description?: string;
  info?: string;
  docsPath?: SettingsDocsPath;
  badge?: string;
  dependent?: boolean;
  children: ReactNode;
  controlId?: string;
}) {
  return (
    <div className="settings-form-row" data-align={align} data-dependent={dependent || undefined}>
      <div className="settings-form-row__text">
        <div className="settings-form-row__label">
          <span>{controlId ? <label htmlFor={controlId}>{label}</label> : label}</span>
          {badge ? <span className="settings-form-row__badge">{badge}</span> : null}
          {info && typeof label === 'string' ? <SettingsInfo label={label} detail={info} docsPath={docsPath} /> : null}
        </div>
        {description ? <div className="settings-form-row__description">{description}</div> : null}
      </div>
      <div className="settings-form-row__control">{children}</div>
    </div>
  );
}

export function SettingsSwitchRow({
  label,
  id,
  checked,
  disabled,
  onChange,
  ...row
}: {
  label: string;
  id?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  info?: string;
  docsPath?: SettingsDocsPath;
  badge?: string;
  dependent?: boolean;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <SettingsFormRow {...row} label={label} controlId={controlId}>
      <label className="settings-switch-hit">
        <input
          id={controlId}
          type="checkbox"
          role="switch"
          className="webclipper-switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </SettingsFormRow>
  );
}

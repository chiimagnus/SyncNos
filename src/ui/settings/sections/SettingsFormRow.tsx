import { useId, type ReactNode } from 'react';
import { SettingsInfo } from './SettingsInfo';
import type { SettingsDocsPath } from '@ui/settings/SettingsDocsLink';

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

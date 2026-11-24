import type { ReactNode } from 'react';

export function SettingsGroup({
  title,
  children,
  note,
  ariaLabel,
}: {
  title: string;
  children: ReactNode;
  note?: string;
  ariaLabel?: string;
}) {
  return (
    <section className="settings-group" aria-label={ariaLabel ?? title}>
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-body">{children}</div>
      {note ? <p className="settings-group-note">{note}</p> : null}
    </section>
  );
}

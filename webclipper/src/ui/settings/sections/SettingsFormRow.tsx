import type { ReactNode } from 'react';

type RowAlign = 'center' | 'start';

export function SettingsFormRow(props: { label: string; align?: RowAlign; children: ReactNode }) {
  const { label, align = 'center', children } = props;
  const alignClass = align === 'start' ? 'tw-items-start' : 'tw-items-center';

  return (
    <div className={`tw-grid tw-grid-cols-[110px_1fr] ${alignClass} tw-gap-3`}>
      <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">{label}</div>
      <div>{children}</div>
    </div>
  );
}

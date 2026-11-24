import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

export function SettingsExternalLink({
  id,
  href,
  label,
  icon: Icon = ArrowUpRight,
}: {
  id?: string;
  href: string;
  label: string;
  icon?: LucideIcon;
}) {
  return (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="settings-info"
      {...tooltipAttrs(label, 'bottom-end')}
    >
      <Icon size={18} aria-hidden="true" />
    </a>
  );
}

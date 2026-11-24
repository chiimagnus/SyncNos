import { ArrowUpRight } from 'lucide-react';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

export function SettingsExternalLink({ id, href, label }: { id?: string; href: string; label: string }) {
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
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  );
}

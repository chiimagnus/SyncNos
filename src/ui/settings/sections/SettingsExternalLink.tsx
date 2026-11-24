import { ArrowUpRight } from 'lucide-react';

export function SettingsExternalLink({ id, href, label }: { id?: string; href: string; label: string }) {
  return (
    <a id={id} href={href} target="_blank" rel="noreferrer" aria-label={label} className="settings-info">
      <ArrowUpRight size={17} aria-hidden="true" />
    </a>
  );
}

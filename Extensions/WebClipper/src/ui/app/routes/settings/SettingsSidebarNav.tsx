import type { SettingsSectionKey } from './types';
import { SETTINGS_SECTIONS } from './types';

export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
}) {
  const { activeSection, onSelectSection } = props;

  return (
    <aside className="tw-w-[240px] tw-shrink-0 tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/40">
      <div className="tw-p-4">
        <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">Settings</div>
        <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">Integrations, backup, and app behavior.</div>
      </div>

      <nav className="tw-px-2 tw-pb-4" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s) => {
          const active = activeSection === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectSection(s.key)}
              className={[
                'tw-flex tw-w-full tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-left tw-transition-colors tw-duration-200',
                active
                  ? 'tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]'
                  : 'tw-border-transparent tw-bg-transparent tw-text-[var(--muted)] hover:tw-border-[var(--border)] hover:tw-bg-white/40 hover:tw-text-[var(--text)]',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              <div className="tw-text-xs tw-font-extrabold">{s.label}</div>
              <div className={['tw-text-[11px] tw-font-semibold', active ? 'tw-text-[var(--muted)]' : 'tw-text-[var(--muted)]'].join(' ')}>
                {s.description}
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

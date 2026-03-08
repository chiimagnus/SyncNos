import { t } from '../../i18n';
import type { SettingsSectionKey } from './types';
import { SETTINGS_SECTION_GROUPS } from './types';

function sectionLabel(key: SettingsSectionKey): string {
  if (key === 'chat_with') return 'Chat with AI';
  return t(`section_${key}_label` as Parameters<typeof t>[0]);
}

function sectionDescription(key: SettingsSectionKey): string {
  if (key === 'chat_with') return 'Prompt + platforms';
  return t(`section_${key}_desc` as Parameters<typeof t>[0]);
}

export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
}) {
  const { activeSection, onSelectSection } = props;

  return (
    <aside className="tw-w-[240px] tw-shrink-0 tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/40">
      <nav className="tw-p-2 tw-pb-4" aria-label={t('settingsSectionsAria')}>
        <div className="tw-flex tw-flex-col tw-gap-3">
          {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => (
            <div key={groupIndex} className="tw-flex tw-flex-col tw-gap-1.5">
              <div className="tw-px-3 tw-pb-1 tw-text-[10px] tw-font-black tw-uppercase tw-tracking-[0.18em] tw-text-[var(--muted)]/80">
                {group.title}
              </div>
              {group.sections.map((section) => {
                const active = activeSection === section.key;
                const label = sectionLabel(section.key);
                const description = sectionDescription(section.key);
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => onSelectSection(section.key)}
                    className={[
                      'tw-flex tw-w-full tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-left tw-transition-colors tw-duration-200',
                      active
                        ? 'tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]'
                        : 'tw-border-transparent tw-bg-transparent tw-text-[var(--muted)] hover:tw-border-[var(--border)] hover:tw-bg-white/40 hover:tw-text-[var(--text)]',
                    ].join(' ')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <div className="tw-text-xs tw-font-extrabold">{label}</div>
                    <div className={['tw-text-[11px] tw-font-semibold', active ? 'tw-text-[var(--muted)]' : 'tw-text-[var(--muted)]'].join(' ')}>
                      {description}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}

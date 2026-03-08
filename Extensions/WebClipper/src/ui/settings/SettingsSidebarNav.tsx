import { t } from '../../i18n';
import type { SettingsSectionKey } from './types';
import { SETTINGS_SECTION_GROUPS } from './types';

function sectionLabel(key: SettingsSectionKey): string {
  if (key === 'chat_with') return 'Chat with AI';
  return t(`section_${key}_label` as Parameters<typeof t>[0]);
}

export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
}) {
  const { activeSection, onSelectSection } = props;

  return (
    <aside className="tw-w-[220px] tw-shrink-0 tw-bg-[var(--panel)]/24">
      <nav className="tw-p-3 tw-pb-4" aria-label={t('settingsSectionsAria')}>
        <div className="tw-flex tw-flex-col tw-gap-4">
          {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className={[
                'tw-flex tw-flex-col tw-gap-0.5',
                groupIndex === 0 ? '' : 'tw-pt-3',
              ].join(' ')}
            >
              <div className="tw-px-3 tw-pb-1.5 tw-text-[10px] tw-font-black tw-uppercase tw-tracking-[0.16em] tw-text-[var(--muted)] tw-opacity-65">
                {group.title}
              </div>
              {group.sections.map((section) => {
                const active = activeSection === section.key;
                const label = sectionLabel(section.key);
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => onSelectSection(section.key)}
                    className={[
                      'tw-flex tw-min-h-9 tw-w-full tw-appearance-none tw-items-center tw-rounded-xl tw-border-0 tw-px-3 tw-text-left tw-shadow-none tw-transition-colors tw-duration-150',
                      active
                        ? 'tw-bg-[var(--btn-bg)] tw-text-[var(--text)]'
                        : 'tw-bg-transparent tw-text-[var(--muted)] hover:tw-bg-white/38 hover:tw-text-[var(--text)]',
                    ].join(' ')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <div className="tw-truncate tw-text-[13px] tw-font-black tw-leading-5">{label}</div>
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

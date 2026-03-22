import { t } from '@i18n';
import { navGroupTitleClassName, navItemClassName } from '@ui/shared/nav-styles';
import type { SettingsSectionKey } from '@viewmodels/settings/types';
import { SETTINGS_SECTION_GROUPS } from '@viewmodels/settings/types';

function sectionLabel(key: SettingsSectionKey): string {
  return t(`section_${key}_label` as Parameters<typeof t>[0]);
}

export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
}) {
  const { activeSection, onSelectSection } = props;

  return (
    <aside className="tw-flex tw-w-[220px] tw-min-h-0 tw-shrink-0 tw-flex-col tw-border-r tw-border-[var(--border)] tw-bg-[var(--bg-sunken)]">
      <nav
        className="tw-flex-1 tw-min-h-0 tw-overflow-y-auto tw-overflow-x-hidden tw-px-4 tw-py-5"
        aria-label={t('settingsSectionsAria')}
      >
        <div className="tw-flex tw-flex-col tw-gap-4">
          {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className={[
                'tw-flex tw-flex-col tw-gap-0.5',
                groupIndex === 0 ? '' : 'tw-pt-3',
              ].join(' ')}
            >
              <div className={navGroupTitleClassName()}>{group.title}</div>
              {group.sections.map((section) => {
                const active = activeSection === section.key;
                const label = sectionLabel(section.key);
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => onSelectSection(section.key)}
                    className={navItemClassName(active)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <div className="tw-truncate tw-leading-5">{label}</div>
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

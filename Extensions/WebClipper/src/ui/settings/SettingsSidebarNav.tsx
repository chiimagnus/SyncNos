import { t } from '../../i18n';
import { navGroupTitleClassName, navItemClassName } from '../shared/nav-styles';
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

import { t } from '@i18n';
import { buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';
import { SETTINGS_SECTION_GROUPS, type SettingsSectionKey } from '@viewmodels/settings/types';

function sectionLabel(key: SettingsSectionKey): string {
  return t(`section_${key}_label` as Parameters<typeof t>[0]);
}

export function SettingsTopTabsNav(props: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
}) {
  const { activeSection, onSelectSection } = props;

  return (
    <nav className="tw-overflow-x-auto tw-overflow-y-hidden tw-px-2 tw-py-2" aria-label={t('settingsSectionsAria')}>
      <div className="tw-flex tw-min-w-max tw-items-center tw-gap-1.5">
        {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="tw-flex tw-items-center tw-gap-1.5">
            {group.sections.map((section) => {
              const active = activeSection === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => onSelectSection(section.key)}
                  className={[
                    active ? buttonFilledClassName() : buttonTintClassName(),
                    'tw-shrink-0 tw-whitespace-nowrap',
                  ].join(' ')}
                  aria-current={active ? 'page' : undefined}
                >
                  {sectionLabel(section.key)}
                </button>
              );
            })}

            {groupIndex === SETTINGS_SECTION_GROUPS.length - 1 ? null : (
              <span
                className="tw-mx-0.5 tw-h-5 tw-w-px tw-shrink-0 tw-bg-[var(--border)] tw-opacity-70"
                aria-hidden="true"
              />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}


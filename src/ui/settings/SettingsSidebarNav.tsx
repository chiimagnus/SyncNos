import { Settings, Keyboard, Terminal, DatabaseBackup, ChartNoAxesColumn, Info, ChevronRight, X } from 'lucide-react';
import { t } from '@i18n';
import { getURL } from '@services/shared/runtime';
import { navItemClassName } from '@ui/shared/nav-styles';
import { SETTINGS_SECTION_GROUPS, type SettingsSectionKey } from '@viewmodels/settings/types';

type LabelKey = Parameters<typeof t>[0];

export function settingsSectionLabel(key: SettingsSectionKey): string {
  return t(`section_${key}_label` as LabelKey);
}

const groupLabels = {
  preferences: 'settingsPreferences',
  sync: 'settingsSyncServices',
  data: 'settingsData',
  about: 'section_aboutme_label',
} as const;

const icons = {
  general: Settings,
  shortcuts: Keyboard,
  cli: Terminal,
  backup: DatabaseBackup,
  aboutyou: ChartNoAxesColumn,
  aboutme: Info,
};

const iconColors: Record<SettingsSectionKey, string> = {
  general: '#687280',
  shortcuts: '#566273',
  cli: '#333a42',
  backup: '#47866b',
  aboutyou: '#567aa4',
  aboutme: '#7788a6',
  notion: '#fff',
  feishu: '#3984ce',
  obsidian: '#7960bb',
  github: '#fff',
};

function SectionIcon({ section }: { section: SettingsSectionKey }) {
  const Icon = section in icons ? icons[section as keyof typeof icons] : undefined;
  return (
    <span className="settings-nav-icon" style={{ backgroundColor: iconColors[section] }} aria-hidden="true">
      {Icon ? (
        <Icon size={15} strokeWidth={1.8} />
      ) : (
        <img src={getURL(`icons/${section}.svg` as any) || undefined} alt="" />
      )}
    </span>
  );
}

export function SettingsSidebarNav({
  activeSection,
  onSelectSection,
  narrow = false,
  onClose,
}: {
  activeSection: SettingsSectionKey;
  onSelectSection: (key: SettingsSectionKey) => void;
  narrow?: boolean;
  onClose?: () => void;
}) {
  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__heading">
        <img src={getURL('icons/icon-128.png' as any) || undefined} alt="" />
        <div className="tw-min-w-0 tw-flex-1">
          <strong>SyncNos</strong>
          <small>{t('settingsTitle')}</small>
        </div>
        {narrow && onClose ? (
          <button type="button" className="settings-info" aria-label={t('closeSettings')} onClick={onClose}>
            <X size={18} />
          </button>
        ) : null}
      </div>
      <nav aria-label={t('settingsSectionsAria')}>
        {SETTINGS_SECTION_GROUPS.map((group) => (
          <div key={group.key} className="settings-nav-group">
            {group.key !== 'about' ? <h2 className="settings-nav-heading">{t(groupLabels[group.key])}</h2> : null}
            {group.sections.map(({ key }) => (
              <button
                key={key}
                type="button"
                className={`${navItemClassName(activeSection === key)} settings-nav-item`}
                data-settings-section={key}
                aria-current={activeSection === key ? 'page' : undefined}
                onClick={() => onSelectSection(key)}
              >
                <SectionIcon section={key} />
                <span className="tw-min-w-0 tw-flex-1">{settingsSectionLabel(key)}</span>
                {narrow ? <ChevronRight size={14} aria-hidden="true" className="tw-shrink-0 tw-opacity-60" /> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

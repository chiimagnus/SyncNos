import { useEffect, useMemo, useState } from 'react';

import { getURL } from '../../platform/runtime/runtime';

import { t } from '../../i18n';
import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';

import { useSettingsSceneController } from './hooks/useSettingsSceneController';
import { SettingsSidebarNav } from './SettingsSidebarNav';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from './types';
import { AboutSection } from './sections/AboutSection';
import { BackupSection } from './sections/BackupSection';
import { InpageSection } from './sections/InpageSection';
import { NotionAISection } from './sections/NotionAISection';
import { NotionOAuthSection } from './sections/NotionOAuthSection';
import { ObsidianSettingsSection } from './sections/ObsidianSettingsSection';

type NarrowRoute = 'list' | 'detail';

export type SettingsSceneProps = {
  activeSection: SettingsSectionKey;
  focusKey?: string;
  onSelectSection: (key: SettingsSectionKey) => void;
  defaultNarrowRoute?: NarrowRoute;
};

export function SettingsScene(props: SettingsSceneProps) {
  const { activeSection, focusKey = '', onSelectSection, defaultNarrowRoute = 'list' } = props;

  const isNarrow = useIsNarrowScreen();
  const [narrowRoute, setNarrowRoute] = useState<NarrowRoute>(defaultNarrowRoute);

  useEffect(() => {
    if (!isNarrow) return;
    setNarrowRoute(defaultNarrowRoute);
  }, [defaultNarrowRoute, isNarrow]);

  const setActiveSection = (key: SettingsSectionKey) => {
    onSelectSection(key);
    if (isNarrow) setNarrowRoute('detail');
  };

  const {
    busy,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionParentPageId,
    notionPageOptions,
    notionStatusText,
    notionAiModelIndex,
    setNotionAiModelIndex,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,
    onSaveNotionAiModelIndex,
    onResetNotionAiModelIndex,
    notionAiRef,

    obsidianApiBaseUrl,
    setObsidianApiBaseUrl,
    obsidianAuthHeaderName,
    setObsidianAuthHeaderName,
    obsidianApiKeyDraft,
    setObsidianApiKeyDraft,
    obsidianApiKeyPresent,
    obsidianApiKeyMasked,
    obsidianChatFolder,
    setObsidianChatFolder,
    obsidianArticleFolder,
    setObsidianArticleFolder,
    obsidianStatus,
    onSaveObsidianSettings,
    onTestObsidianConnection,
    onOpenObsidianSetupGuide,

    exportStatus,
    importStatus,
    importStats,
    lastBackupExportAt,
    backupImportRef,
    fileInputRef,
    useAppImport,
    handleBackupExport,
    importFromFile,
    handleBackupImportClick,

    inpageSupportedOnly,
    onToggleInpageSupportedOnly,
  } = useSettingsSceneController({ activeSection, focusKey });

  const renderDetailContent = () => (
    <section className="route-scroll tw-mx-auto tw-grid tw-w-full tw-max-w-[980px] tw-gap-4 tw-pr-1">
      {activeSection === 'notion' ? (
        <>
          <NotionOAuthSection
            busy={busy}
            notionStatusText={notionStatusText}
            notionConnected={!!notionConnected}
            pollingNotion={pollingNotion}
            loadingNotionPages={loadingNotionPages}
            notionParentPageId={notionParentPageId}
            notionPageOptions={notionPageOptions}
            notionLogoUrl={getURL('icons/notion.svg' as any)}
            onConnectOrDisconnect={() => {
              void onNotionConnectOrDisconnect();
            }}
            onSaveNotionParentPage={(id) => {
              void onSaveNotionParentPage(id);
            }}
            onLoadNotionPages={() => {
              void onLoadNotionPages();
            }}
          />

          <div ref={notionAiRef} id="settings-notion-ai">
            <NotionAISection
              busy={busy}
              modelIndex={notionAiModelIndex}
              onChangeModelIndex={setNotionAiModelIndex}
              onSave={() => {
                void onSaveNotionAiModelIndex();
              }}
              onReset={() => {
                void onResetNotionAiModelIndex();
              }}
            />
          </div>
        </>
      ) : null}

      {activeSection === 'obsidian' ? (
        <ObsidianSettingsSection
          busy={busy}
          apiBaseUrl={obsidianApiBaseUrl}
          authHeaderName={obsidianAuthHeaderName}
          apiKeyDraft={obsidianApiKeyDraft}
          apiKeyPresent={obsidianApiKeyPresent}
          apiKeyMasked={obsidianApiKeyMasked}
          chatFolder={obsidianChatFolder}
          articleFolder={obsidianArticleFolder}
          statusText={obsidianStatus}
          obsidianLogoUrl={getURL('icons/obsidian.svg' as any)}
          onChangeApiBaseUrl={setObsidianApiBaseUrl}
          onChangeAuthHeaderName={setObsidianAuthHeaderName}
          onChangeApiKeyDraft={setObsidianApiKeyDraft}
          onChangeChatFolder={setObsidianChatFolder}
          onChangeArticleFolder={setObsidianArticleFolder}
          onSave={() => {
            void onSaveObsidianSettings();
          }}
          onSaveApiKey={() => {
            void onSaveObsidianSettings({ includeApiKey: true });
          }}
          onTest={() => {
            void onTestObsidianConnection();
          }}
          onOpenSetupGuide={onOpenObsidianSetupGuide}
        />
      ) : null}

      {activeSection === 'backup' ? (
        <BackupSection
          busy={busy}
          exportStatus={exportStatus}
          importStatus={importStatus}
          importStats={importStats}
          lastBackupExportAt={lastBackupExportAt}
          backupImportRef={backupImportRef}
          fileInputRef={fileInputRef}
          importLabel={useAppImport ? 'Import in App' : undefined}
          onImportClick={
            useAppImport
              ? () => {
                  void handleBackupImportClick();
                }
              : undefined
          }
          onExport={() => {
            void handleBackupExport();
          }}
          onImportFile={(file) => {
            void importFromFile(file);
          }}
        />
      ) : null}

      {activeSection === 'inpage' ? (
        <InpageSection
          busy={busy}
          supportedOnly={inpageSupportedOnly}
          onToggleSupportedOnly={(next) => {
            void onToggleInpageSupportedOnly(next);
          }}
        />
      ) : null}

      {activeSection === 'about' ? <AboutSection /> : null}
    </section>
  );

  const activeSectionMeta = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.key === activeSection) ?? null,
    [activeSection]
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
          <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--panel)]/60 tw-px-3 tw-py-2 tw-backdrop-blur-sm">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <button
                type="button"
                className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)]"
                onClick={() => setNarrowRoute('list')}
                aria-label="Back"
              >
                {t('backButton')}
              </button>
              <div className="tw-min-w-0 tw-flex-1 tw-text-center tw-text-xs tw-font-extrabold tw-text-[var(--muted)]">
                {activeSectionMeta ? t(`section_${activeSectionMeta.key}_label` as Parameters<typeof t>[0]) : 'Settings'}
              </div>
              <div className="tw-w-[74px]" aria-hidden="true" />
            </div>
          </div>

          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
            {renderDetailContent()}
          </div>
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
        <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-2">
          <nav className="tw-grid tw-gap-2" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className="tw-flex tw-w-full tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-px-3 tw-py-3 tw-text-left tw-transition tw-duration-150 hover:tw-border-[var(--border-strong)] hover:tw-shadow-[var(--shadow)]"
              >
                <div className="tw-text-sm tw-font-extrabold tw-text-[var(--text)]">{t(`section_${section.key}_label` as Parameters<typeof t>[0])}</div>
                <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{t(`section_${section.key}_desc` as Parameters<typeof t>[0])}</div>
              </button>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0">
      <SettingsSidebarNav activeSection={activeSection} onSelectSection={setActiveSection} />
      <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden tw-p-4">{renderDetailContent()}</div>
    </div>
  );
}

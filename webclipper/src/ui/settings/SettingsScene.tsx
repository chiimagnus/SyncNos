import { useEffect, useMemo, useState } from 'react';

import { getURL } from '../../platform/runtime/runtime';

import { t } from '../../i18n';
import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';
import { buttonFilledClassName, buttonTintClassName } from '../shared/button-styles';

import { useSettingsSceneController } from './hooks/useSettingsSceneController';
import { SettingsSidebarNav } from './SettingsSidebarNav';
import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS, type SettingsSectionKey } from './types';
import { AboutSection } from './sections/AboutSection';
import { BackupSection } from './sections/BackupSection';
import { ChatWithAiSection } from './sections/ChatWithAiSection';
import { InsightSection } from './sections/InsightSection';
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

function getSectionLabel(key: SettingsSectionKey): string {
  return t(`section_${key}_label` as Parameters<typeof t>[0]);
}

function getSectionDescription(key: SettingsSectionKey): string {
  return t(`section_${key}_desc` as Parameters<typeof t>[0]);
}

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

    notionSyncEnabled,
    onToggleNotionSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
  notionAiModelIndex,
  setNotionAiModelIndex,
	    notionParentPageId,
	    notionPageOptions,
	    notionStatusText,
  onSaveNotionAiModelIndex,
  onResetNotionAiModelIndex,
  notionAiRef,
	    onNotionConnectOrDisconnect,
	    onSaveNotionParentPage,
	    onLoadNotionPages,

	    chatWithPromptTemplate,
	    setChatWithPromptTemplate,
	    chatWithMaxChars,
    setChatWithMaxChars,
    chatWithPlatforms,
    setChatWithPlatforms,
    onResetChatWithSettings,

    obsidianSyncEnabled,
    onToggleObsidianSyncEnabled,

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

    inpageDisplayMode,
    onChangeInpageDisplayMode,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,

    insightStats,
    insightLoading,
    insightError,
    hasLoadedInsight,
    insightRange,
    setInsightRange,
  } = useSettingsSceneController({ activeSection, focusKey });

  const detailMaxWidthClassName = activeSection === 'insight' ? 'tw-max-w-[1120px]' : 'tw-max-w-[980px]';

  const renderDetailContent = () => (
    <section className={`route-scroll tw-mx-auto tw-grid tw-w-full ${detailMaxWidthClassName} tw-gap-4 tw-pr-1`}>
        {activeSection === 'notion' ? (
          <>
            <NotionOAuthSection
            busy={busy}
            syncEnabled={notionSyncEnabled}
            notionStatusText={notionStatusText}
            notionConnected={!!notionConnected}
            pollingNotion={pollingNotion}
            loadingNotionPages={loadingNotionPages}
            notionParentPageId={notionParentPageId}
            notionPageOptions={notionPageOptions}
            notionLogoUrl={getURL('icons/notion.svg' as any)}
            onToggleSyncEnabled={(enabled) => {
              void onToggleNotionSyncEnabled(enabled);
            }}
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

      {activeSection === 'chat_with' ? (
        <ChatWithAiSection
          busy={busy}
          promptTemplate={chatWithPromptTemplate}
          onChangePromptTemplate={setChatWithPromptTemplate}
          maxChars={chatWithMaxChars}
          onChangeMaxChars={setChatWithMaxChars}
          platforms={chatWithPlatforms as any}
          onChangePlatforms={setChatWithPlatforms as any}
          onReset={() => {
            void onResetChatWithSettings();
          }}
        />
      ) : null}

      {activeSection === 'obsidian' ? (
        <ObsidianSettingsSection
          busy={busy}
          syncEnabled={obsidianSyncEnabled}
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
          onToggleSyncEnabled={(enabled) => {
            void onToggleObsidianSyncEnabled(enabled);
          }}
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
          importLabel={useAppImport ? t('importInApp') : undefined}
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

      {activeSection === 'insight' ? (
        <InsightSection
          loading={insightLoading}
          error={insightError}
          stats={insightStats}
          hasLoaded={hasLoadedInsight}
          range={insightRange}
          onChangeRange={setInsightRange}
        />
      ) : null}

      {activeSection === 'general' ? (
        <InpageSection
          busy={busy}
          displayMode={inpageDisplayMode}
          onChangeDisplayMode={(next) => {
            void onChangeInpageDisplayMode(next);
          }}
          aiChatAutoSaveEnabled={aiChatAutoSaveEnabled}
          onToggleAiChatAutoSaveEnabled={(next) => {
            void onToggleAiChatAutoSaveEnabled(next);
          }}
          aiChatCacheImagesEnabled={aiChatCacheImagesEnabled}
          onToggleAiChatCacheImagesEnabled={(next) => {
            void onToggleAiChatCacheImagesEnabled(next);
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

  const activeSectionLabel = useMemo(() => {
    return activeSectionMeta ? getSectionLabel(activeSectionMeta.key) : t('settingsTitle');
  }, [activeSectionMeta]);

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
          <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3 tw-py-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <button
                type="button"
                className={buttonTintClassName()}
                onClick={() => setNarrowRoute('list')}
                aria-label={t('backButton')}
              >
                {t('backButton')}
              </button>
              <div className="tw-min-w-0 tw-flex-1 tw-text-center tw-text-xs tw-font-extrabold tw-text-[var(--text-secondary)]">
                {activeSectionLabel}
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
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-2">
          <nav className="tw-grid tw-gap-4" aria-label={t('settingsSectionsAria')}>
            {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => (
              <div key={groupIndex} className="tw-grid tw-gap-1.5">
                <div className="tw-px-2 tw-text-[10px] tw-font-black tw-uppercase tw-tracking-[0.16em] tw-text-[var(--text-secondary)] tw-opacity-65">
                  {group.title}
                </div>
                <div>
                  {group.sections.map((section, index) => {
                    const active = activeSection === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setActiveSection(section.key)}
                        className={[
                          active ? buttonFilledClassName() : buttonTintClassName(),
                          'tw-flex tw-w-full tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-px-3 tw-py-3 tw-text-left',
                          index === 0 ? '' : 'tw-mt-1',
                        ].join(' ')}
                        aria-current={active ? 'page' : undefined}
                      >
                        <div className="tw-text-sm tw-font-black">{getSectionLabel(section.key)}</div>
                        <div
                          className={[
                            'tw-text-[11px] tw-font-semibold tw-opacity-90',
                            active ? 'tw-text-[var(--accent-foreground)]' : 'tw-text-[var(--text-secondary)]',
                          ].join(' ')}
                        >
                          {getSectionDescription(section.key)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
      <SettingsSidebarNav activeSection={activeSection} onSelectSection={setActiveSection} />
      <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden tw-bg-[var(--bg-primary)] tw-p-4">
        {renderDetailContent()}
      </div>
    </div>
  );
}

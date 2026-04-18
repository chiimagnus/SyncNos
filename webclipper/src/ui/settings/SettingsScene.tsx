import { getURL } from '@services/shared/runtime';

import { t } from '@i18n';
import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { headerButtonClassName } from '@ui/shared/button-styles';

import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';
import { SettingsSidebarNav } from '@ui/settings/SettingsSidebarNav';
import { SettingsTopTabsNav } from '@ui/settings/SettingsTopTabsNav';
import { type SettingsSectionKey } from '@viewmodels/settings/types';
import { AboutSection } from '@ui/settings/sections/AboutSection';
import { AiChatsSection } from '@ui/settings/sections/AiChatsSection';
import { BackupSection } from '@ui/settings/sections/BackupSection';
import { ChatWithAiSection } from '@ui/settings/sections/ChatWithAiSection';
import { InsightSection } from '@ui/settings/sections/InsightSection';
import { InpageSection } from '@ui/settings/sections/InpageSection';
import { NotionAISection } from '@ui/settings/sections/NotionAISection';
import { NotionOAuthSection } from '@ui/settings/sections/NotionOAuthSection';
import { ObsidianSettingsSection } from '@ui/settings/sections/ObsidianSettingsSection';
import { WebArticlesSection } from '@ui/settings/sections/WebArticlesSection';
import { VideosSection } from '@ui/settings/sections/VideosSection';

export type SettingsSceneProps = {
  activeSection: SettingsSectionKey;
  focusKey?: string;
  onSelectSection: (key: SettingsSectionKey) => void;
  onClose?: () => void;
};

export function SettingsScene(props: SettingsSceneProps) {
  const { activeSection, focusKey = '', onSelectSection, onClose } = props;

  const isNarrow = useIsNarrowScreen();

  const setActiveSection = (key: SettingsSectionKey) => {
    onSelectSection(key);
  };

  const {
    busy,

    notionSyncEnabled,
    onToggleNotionSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAdvancedOpen,
    notionAiModelIndex,
    setNotionAiModelIndex,
    notionParentPageId,
    notionChatDatabaseId,
    setNotionChatDatabaseId,
    notionArticleDatabaseId,
    setNotionArticleDatabaseId,
    notionChatDatabaseLabel,
    notionArticleDatabaseLabel,
    notionPageOptions,
    notionStatusText,
    onSaveNotionAiModelIndex,
    onResetNotionAiModelIndex,
    notionAiRef,
    onToggleNotionAdvancedOpen,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,

    chatWithPromptTemplate,
    setChatWithPromptTemplate,
    chatWithPlatforms,
    setChatWithPlatforms,
    onSaveChatWithSettings,
    onResetChatWithPlatforms,

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
    markdownReadingProfile,
    onChangeMarkdownReadingProfile,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
    antiHotlinkAdvancedOpen,
    onToggleAntiHotlinkAdvancedOpen,
    antiHotlinkRules,
    antiHotlinkRuleErrors,
    onChangeAntiHotlinkRule,
    onAddAntiHotlinkRule,
    onRemoveAntiHotlinkRule,
    onApplyAntiHotlinkRules,
    onResetAntiHotlinkRules,
    aiChatDollarMentionEnabled,
    onToggleAiChatDollarMentionEnabled,

    insightStats,
    insightLoading,
    insightError,
    hasLoadedInsight,
    insightRange,
    setInsightRange,
    aboutYouUserName,
    onChangeAboutYouUserName,
    onSaveAboutYouUserName,
  } = useSettingsSceneController({ activeSection, focusKey });

  const detailMaxWidthClassName = activeSection === 'aboutyou' ? 'tw-max-w-[1120px]' : 'tw-max-w-[980px]';

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
            notionAdvancedOpen={notionAdvancedOpen}
            notionParentPageId={notionParentPageId}
            notionChatDatabaseId={notionChatDatabaseId}
            notionArticleDatabaseId={notionArticleDatabaseId}
            notionChatDatabaseLabel={notionChatDatabaseLabel}
            notionArticleDatabaseLabel={notionArticleDatabaseLabel}
            notionPageOptions={notionPageOptions}
            notionLogoUrl={getURL('icons/notion.svg' as any)}
            onToggleSyncEnabled={(enabled) => {
              void onToggleNotionSyncEnabled(enabled);
            }}
            onToggleAdvancedOpen={() => {
              onToggleNotionAdvancedOpen();
            }}
            onConnectOrDisconnect={() => {
              void onNotionConnectOrDisconnect();
            }}
            onSaveNotionParentPage={(id) => {
              void onSaveNotionParentPage(id);
            }}
            onChangeNotionChatDatabaseId={setNotionChatDatabaseId}
            onChangeNotionArticleDatabaseId={setNotionArticleDatabaseId}
            onSaveNotionDatabaseId={(kind) => {
              void onSaveNotionDatabaseId(kind);
            }}
            onResetNotionDatabaseId={(kind) => {
              void onResetNotionDatabaseId(kind);
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
          platforms={chatWithPlatforms as any}
          onChangePlatforms={setChatWithPlatforms as any}
          onSave={() => {
            void onSaveChatWithSettings();
          }}
          onResetPlatforms={() => {
            void onResetChatWithPlatforms();
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

      {activeSection === 'aboutyou' ? (
        <InsightSection
          loading={insightLoading}
          error={insightError}
          stats={insightStats}
          hasLoaded={hasLoadedInsight}
          range={insightRange}
          onChangeRange={setInsightRange}
          userName={aboutYouUserName}
          onChangeUserName={onChangeAboutYouUserName}
          onSaveUserName={() => {
            void onSaveAboutYouUserName();
          }}
        />
      ) : null}

      {activeSection === 'general' ? (
        <InpageSection
          busy={busy}
          displayMode={inpageDisplayMode}
          onChangeDisplayMode={(next) => {
            void onChangeInpageDisplayMode(next);
          }}
          markdownReadingProfile={markdownReadingProfile}
          onChangeMarkdownReadingProfile={(next) => {
            void onChangeMarkdownReadingProfile(next);
          }}
          aiChatAutoSaveEnabled={aiChatAutoSaveEnabled}
          onToggleAiChatAutoSaveEnabled={(next) => {
            void onToggleAiChatAutoSaveEnabled(next);
          }}
          aiChatCacheImagesEnabled={aiChatCacheImagesEnabled}
          onToggleAiChatCacheImagesEnabled={(next) => {
            void onToggleAiChatCacheImagesEnabled(next);
          }}
          webArticleCacheImagesEnabled={webArticleCacheImagesEnabled}
          onToggleWebArticleCacheImagesEnabled={(next) => {
            void onToggleWebArticleCacheImagesEnabled(next);
          }}
          antiHotlinkAdvancedOpen={antiHotlinkAdvancedOpen}
          onToggleAntiHotlinkAdvancedOpen={onToggleAntiHotlinkAdvancedOpen}
          antiHotlinkRules={antiHotlinkRules}
          antiHotlinkRuleErrors={antiHotlinkRuleErrors}
          onChangeAntiHotlinkRule={onChangeAntiHotlinkRule}
          onAddAntiHotlinkRule={onAddAntiHotlinkRule}
          onRemoveAntiHotlinkRule={onRemoveAntiHotlinkRule}
          onApplyAntiHotlinkRules={() => {
            void onApplyAntiHotlinkRules();
          }}
          onResetAntiHotlinkRules={() => {
            void onResetAntiHotlinkRules();
          }}
          aiChatDollarMentionEnabled={aiChatDollarMentionEnabled}
          onToggleAiChatDollarMentionEnabled={(next) => {
            void onToggleAiChatDollarMentionEnabled(next);
          }}
        />
      ) : null}

      {activeSection === 'articles' ? <WebArticlesSection /> : null}

      {activeSection === 'ai_chats' ? <AiChatsSection /> : null}

      {activeSection === 'videos' ? <VideosSection /> : null}

      {activeSection === 'aboutme' ? <AboutSection /> : null}
    </section>
  );

  if (isNarrow) {
    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)]">
          <SettingsTopTabsNav
            activeSection={activeSection}
            onSelectSection={setActiveSection}
            rightSlot={
              onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={headerButtonClassName()}
                  aria-label={t('closeSettings')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4 4L12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null
            }
          />
        </div>

        <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-bg-[var(--bg-primary)] tw-p-3">
          {renderDetailContent()}
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

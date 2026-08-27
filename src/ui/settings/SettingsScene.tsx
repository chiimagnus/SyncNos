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
import { NotionOAuthSection } from '@ui/settings/sections/NotionOAuthSection';
import { FeishuOAuthSection } from '@ui/settings/sections/FeishuOAuthSection';
import { ObsidianSettingsSection } from '@ui/settings/sections/ObsidianSettingsSection';
import { GitHubSettingsSection } from '@ui/settings/sections/GitHubSettingsSection';
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
    error,
    clearError,

    notionSyncEnabled,
    onToggleNotionSyncEnabled,
    notionAutoSyncEnabled,
    onToggleNotionAutoSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAdvancedOpen,
    notionParentPageId,
    notionChatDatabaseId,
    setNotionChatDatabaseId,
    notionArticleDatabaseId,
    setNotionArticleDatabaseId,
    notionVideoDatabaseId,
    setNotionVideoDatabaseId,
    notionChatDatabaseLabel,
    notionArticleDatabaseLabel,
    notionVideoDatabaseLabel,
    notionPageOptions,
    notionStatusText,
    onToggleNotionAdvancedOpen,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,

    feishuSyncEnabled,
    onToggleFeishuSyncEnabled,
    feishuAutoSyncEnabled,
    onToggleFeishuAutoSyncEnabled,

    feishuConnected,
    pollingFeishu,
    feishuPendingState,
    feishuLastError,
    feishuClientId,
    setFeishuClientId,
    feishuClientSecret,
    setFeishuClientSecret,
    feishuTokenExchangeProxyUrl,
    setFeishuTokenExchangeProxyUrl,
    feishuChatFolder,
    setFeishuChatFolder,
    feishuArticleFolder,
    setFeishuArticleFolder,
    feishuVideoFolder,
    setFeishuVideoFolder,
    feishuStatusText,
    onSaveFeishuPaths,
    onSaveFeishuAdvancedSettings,
    onFeishuConnectOrDisconnect,
    onOpenFeishuSetupGuide,
    feishuSetupGuideUrl,

    chatWithPromptTemplate,
    setChatWithPromptTemplate,
    chatWithPlatforms,
    setChatWithPlatforms,
    onSaveChatWithSettings,
    onResetChatWithPlatforms,

    obsidianSyncEnabled,
    onToggleObsidianSyncEnabled,
    obsidianAutoSyncEnabled,
    onToggleObsidianAutoSyncEnabled,

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
    obsidianVideoFolder,
    setObsidianVideoFolder,
    obsidianStatus,
    onSaveObsidianSettings,
    onTestObsidianConnection,
    onOpenObsidianSetupGuide,
    obsidianSetupGuideUrl,

    githubAuth,
    githubAccount,
    githubRepositoryStatus,
    githubRepositories,
    githubTargetUnavailable,
    githubRepository,
    onChangeGithubRepository,
    githubBranch,
    setGithubBranch,
    githubVerificationUrl,
    githubAppUrl,
    githubInstallUrl,
    githubSyncEnabled,
    onToggleGithubSyncEnabled,
    githubAutoSyncEnabled,
    onToggleGithubAutoSyncEnabled,
    githubConnectionTest,
    onGithubConnect,
    onCancelGithubDeviceFlow,
    onDisconnectGithub,
    onRefreshGithubRepositories,
    onSaveGithubSettings,
    onTestGithubConnection,

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
    localePreference,
    onChangeLocalePreference,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
    xiaohongshuCommentsCaptureEnabled,
    onToggleXiaohongshuCommentsCaptureEnabled,
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
      {error ? (
        <section
          className={[
            'tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--error)] tw-bg-[var(--bg-card)] tw-p-3',
            'tw-text-[var(--text-primary)]',
          ].join(' ')}
          aria-label="settings-error"
        >
          <div className="tw-flex tw-items-start tw-gap-3">
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-text-sm tw-font-black tw-text-[var(--error)]">{error}</div>
            </div>
            <button type="button" className={headerButtonClassName()} onClick={clearError} aria-label="dismiss error">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4L12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </section>
      ) : null}
      {activeSection === 'notion' ? (
        <>
          <NotionOAuthSection
            busy={busy}
            syncEnabled={notionSyncEnabled}
            autoSyncEnabled={notionAutoSyncEnabled}
            notionStatusText={notionStatusText}
            notionConnected={!!notionConnected}
            pollingNotion={pollingNotion}
            loadingNotionPages={loadingNotionPages}
            notionAdvancedOpen={notionAdvancedOpen}
            notionParentPageId={notionParentPageId}
            notionChatDatabaseId={notionChatDatabaseId}
            notionArticleDatabaseId={notionArticleDatabaseId}
            notionVideoDatabaseId={notionVideoDatabaseId}
            notionChatDatabaseLabel={notionChatDatabaseLabel}
            notionArticleDatabaseLabel={notionArticleDatabaseLabel}
            notionVideoDatabaseLabel={notionVideoDatabaseLabel}
            notionPageOptions={notionPageOptions}
            notionLogoUrl={getURL('icons/notion.svg' as any)}
            onToggleSyncEnabled={(enabled) => {
              void onToggleNotionSyncEnabled(enabled);
            }}
            onToggleAutoSyncEnabled={(enabled) => {
              void onToggleNotionAutoSyncEnabled(enabled);
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
            onChangeNotionVideoDatabaseId={setNotionVideoDatabaseId}
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
        </>
      ) : null}

      {activeSection === 'feishu' ? (
        <FeishuOAuthSection
          busy={busy}
          syncEnabled={feishuSyncEnabled}
          autoSyncEnabled={feishuAutoSyncEnabled}
          feishuStatusText={feishuStatusText}
          feishuConnected={!!feishuConnected}
          pollingFeishu={pollingFeishu}
          feishuPendingState={feishuPendingState}
          feishuLastError={feishuLastError}
          feishuClientId={feishuClientId}
          feishuClientSecret={feishuClientSecret}
          feishuTokenExchangeProxyUrl={feishuTokenExchangeProxyUrl}
          feishuChatFolder={feishuChatFolder}
          feishuArticleFolder={feishuArticleFolder}
          feishuVideoFolder={feishuVideoFolder}
          feishuLogoUrl={getURL('icons/feishu.svg' as any)}
          setupGuideUrl={feishuSetupGuideUrl}
          onToggleSyncEnabled={(enabled) => {
            void onToggleFeishuSyncEnabled(enabled);
          }}
          onToggleAutoSyncEnabled={(enabled) => {
            void onToggleFeishuAutoSyncEnabled(enabled);
          }}
          onChangeClientId={setFeishuClientId}
          onChangeClientSecret={setFeishuClientSecret}
          onChangeTokenExchangeProxyUrl={setFeishuTokenExchangeProxyUrl}
          onChangeChatFolder={setFeishuChatFolder}
          onChangeArticleFolder={setFeishuArticleFolder}
          onChangeVideoFolder={setFeishuVideoFolder}
          onSavePaths={() => {
            void onSaveFeishuPaths();
          }}
          onSaveAdvanced={() => {
            void onSaveFeishuAdvancedSettings();
          }}
          onConnectOrDisconnect={() => {
            void onFeishuConnectOrDisconnect();
          }}
          onOpenSetupGuide={onOpenFeishuSetupGuide}
        />
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
          autoSyncEnabled={obsidianAutoSyncEnabled}
          apiBaseUrl={obsidianApiBaseUrl}
          authHeaderName={obsidianAuthHeaderName}
          apiKeyDraft={obsidianApiKeyDraft}
          apiKeyPresent={obsidianApiKeyPresent}
          apiKeyMasked={obsidianApiKeyMasked}
          chatFolder={obsidianChatFolder}
          articleFolder={obsidianArticleFolder}
          videoFolder={obsidianVideoFolder}
          statusText={obsidianStatus}
          obsidianLogoUrl={getURL('icons/obsidian.svg' as any)}
          setupGuideUrl={obsidianSetupGuideUrl}
          onChangeApiBaseUrl={setObsidianApiBaseUrl}
          onChangeAuthHeaderName={setObsidianAuthHeaderName}
          onChangeApiKeyDraft={setObsidianApiKeyDraft}
          onChangeChatFolder={setObsidianChatFolder}
          onChangeArticleFolder={setObsidianArticleFolder}
          onChangeVideoFolder={setObsidianVideoFolder}
          onToggleSyncEnabled={(enabled) => {
            void onToggleObsidianSyncEnabled(enabled);
          }}
          onToggleAutoSyncEnabled={(enabled) => {
            void onToggleObsidianAutoSyncEnabled(enabled);
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

      {activeSection === 'github' ? (
        <GitHubSettingsSection
          busy={busy}
          syncEnabled={githubSyncEnabled}
          autoSyncEnabled={githubAutoSyncEnabled}
          auth={githubAuth}
          account={githubAccount}
          repositoryStatus={githubRepositoryStatus}
          repositories={githubRepositories}
          targetUnavailable={githubTargetUnavailable}
          repository={githubRepository}
          branch={githubBranch}
          verificationUrl={githubVerificationUrl}
          appUrl={githubAppUrl}
          installUrl={githubInstallUrl}
          connectionTest={githubConnectionTest}
          githubLogoUrl={getURL('icons/github.svg' as any)}
          onToggleSyncEnabled={(enabled) => {
            void onToggleGithubSyncEnabled(enabled);
          }}
          onToggleAutoSyncEnabled={(enabled) => {
            void onToggleGithubAutoSyncEnabled(enabled);
          }}
          onConnect={() => {
            void onGithubConnect();
          }}
          onCancelDeviceFlow={() => {
            void onCancelGithubDeviceFlow();
          }}
          onDisconnect={() => {
            void onDisconnectGithub();
          }}
          onRefreshRepositories={() => {
            void onRefreshGithubRepositories();
          }}
          onChangeRepository={onChangeGithubRepository}
          onChangeBranch={setGithubBranch}
          onSaveTarget={() => {
            void onSaveGithubSettings();
          }}
          onTestConnection={() => {
            void onTestGithubConnection();
          }}
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
        />
      ) : null}

      {activeSection === 'general' ? (
        <InpageSection
          busy={busy}
          userName={aboutYouUserName}
          onChangeUserName={onChangeAboutYouUserName}
          onSaveUserName={() => {
            void onSaveAboutYouUserName();
          }}
          displayMode={inpageDisplayMode}
          onChangeDisplayMode={(next) => {
            void onChangeInpageDisplayMode(next);
          }}
          localePreference={localePreference}
          onChangeLocalePreference={(next) => {
            void onChangeLocalePreference(next);
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
          xiaohongshuCommentsCaptureEnabled={xiaohongshuCommentsCaptureEnabled}
          onToggleXiaohongshuCommentsCaptureEnabled={(next) => {
            void onToggleXiaohongshuCommentsCaptureEnabled(next);
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

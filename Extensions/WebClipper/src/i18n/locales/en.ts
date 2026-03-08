export const en = {
  // Settings sections
  section_backup_label: 'Backup',
  section_backup_desc: 'Export/import your database.',
  section_language_label: 'Language',
  section_language_desc: 'Choose the interface language.',
  section_notion_label: 'Notion',
  section_notion_desc: 'OAuth + parent page for sync.',
  section_obsidian_label: 'Obsidian',
  section_obsidian_desc: 'Local REST API settings + sync status.',
  section_inpage_label: 'Inpage',
  section_inpage_desc: 'Inpage button visibility behavior.',
  section_about_label: 'About',
  section_about_desc: 'Project, author, and support links.',
  settingsTitle: 'Settings',
  settingsSectionsAria: 'Settings sections',
  settingsDialogAria: 'Settings',

  // LanguageSection
  languageHeading: 'Language',
  languageLabel: 'Interface Language',
  languageHint: 'Applies to popup, app, and inpage tips.',
  localeEnglish: 'English',
  localeChinese: 'Chinese',

  // InpageSection
  inpageButtonHeading: 'Inpage Button',
  inpageSupportedOnlyLabel: 'Only show Inpage button on supported sites',
  inpageSupportedOnlyHint: 'Non-supported sites require a refresh to apply.',

  // BackupSection
  databaseBackup: 'Database Backup',
  exportZip: 'Export (Zip v2)',
  importDots: 'Import\u2026',
  exportStatus: 'export:',
  lastExport: 'last export:',
  importStatus: 'import:',
  statsConversations: 'Conversations:',
  statsMessages: 'Messages:',
  statsMappings: 'Mappings:',
  statsSettingsApplied: 'Settings applied:',

  // NotionOAuthSection
  notionOAuth: 'Notion OAuth',
  disconnect: 'Disconnect',
  connectingDots: 'Connecting\u2026',
  connect: 'Connect',
  parentPage: 'Parent Page',
  clickRefresh: 'Click refresh \u2192',
  refresh: 'Refresh',
  refreshPagesAria: 'Refresh pages',
  connectNotionFirst: 'Connect Notion first',

  // NotionAISection
  notionAI: 'Notion AI',
  modelIndex: 'Model Index',
  save: 'Save',
  reset: 'Reset',
  note: 'Note',
  notionAiModelNote:
    'Applies only when Notion AI model is set to Auto. Menu order may change in Notion.',

  // ObsidianSettingsSection
  obsidianLocalRestApi: 'Obsidian Local REST API',
  baseUrl: 'Base URL',
  apiKey: 'API Key',
  authHeader: 'Auth Header',
  test: 'Test',
  status: 'Status',
  obsidianInstallNote: 'Install and configure Obsidian Local REST API first.',
  openSetupGuide: 'Open Setup Guide',
  obsidianPaths: 'Obsidian Paths',
  aiChatsFolder: 'AI Chats Folder',
  webClipperFolder: 'Web Clipper Folder',
  obsidianPathsNote:
    'Vault-relative folder paths. Nested folders supported. Empty uses defaults.',

  // AboutSection
  macApp: 'Mac App',
  sourceCode: 'Source Code',
  changelog: 'Changelog',
  mail: 'Mail',
  versionPrefix: 'Version',
  authorTagline: 'Time Machine Creator~',

  // ConversationListPane
  allFilter: 'All',
  noConversations: 'No conversations yet.',
  // untitled is shared: used by ConversationListPane, ConversationDetailPane, and ConversationsScene
  untitled: '(Untitled)',
  selectLabel: 'Select',
  selectAll: 'Select all',
  copyFullMarkdown: 'Copy full markdown',
  copied: 'Copied',
  openChat: 'Open chat',
  noLinkAvailable: 'No link available',
  openOriginalChat: 'Open original chat',
  warningBadge: 'warning',
  skipped: 'skipped',
  deleteButton: 'Delete',
  exportButton: 'Export',
  exportOptions: 'Export options',
  singleMarkdown: 'Single Markdown',
  multiMarkdown: 'Multi Markdown',
  obsidianSync: 'Obsidian',
  obsidianSyncing: 'Obsidian...',
  notionSync: 'Notion',
  notionSyncing: 'Notion...',
  todayLabel: 'Today:',
  totalLabel: 'Total:',
  deleteConfirmTitle: 'Delete selected conversations?',
  deleteConfirmBody: 'This cannot be undone.',
  cancelButton: 'Cancel',
  deletingDots: 'Deleting...',

  // ConversationDetailPane
  backButton: 'Back',
  chatsTitle: 'Chats',
  detailTitle: 'Detail',
  messageRoleFallback: 'Message',
  selectConversationHint: 'Select one conversation from list',
  loadingDots: 'Loading\u2026',
  noMessages: 'No messages.',
  selectAConversation: 'Select a conversation.',

  // ConversationSyncFeedbackNotice
  phaseRunning: 'Syncing',
  phaseSuccess: 'Completed',
  phasePartialFailed: 'Partial failure',
  phaseFailed: 'Failed',
  issuesSingular: 'issue',
  issuesPlural: 'issues',
  hideDetails: 'Hide details',
  viewDetails: 'View details',
  stagePrefix: 'Stage:',
  currentPrefix: 'Current:',
  syncDetails: 'sync details',
  dismissSyncFeedback: 'Dismiss sync feedback',
  warningsHeading: 'Warnings',
  conversationLabel: 'Conversation',

  // PopupShell
  backToChats: 'Back to chats',
  openSettings: 'Open Settings',
  currentPageCannotBeCaptured: 'Current page cannot be captured',
  moreActionsSoon: 'More actions coming soon',
  moreButton: 'More',
  chatsAria: 'Chats',

  // usePopupCurrentPageCapture
  checkingCurrentPage: 'Checking current page...',
  unavailable: 'Unavailable',
  fetchArticle: 'Fetch Article',
  fetchAiChat: 'Fetch AI Chat',
  savingDots: 'Saving...',
  loadingFullHistory: 'Loading full history...',
  captureFailedFallback: 'Capture failed',
  fetchingDots: 'Fetching...',
  checkingDots: 'Checking...',
  savedPrefix: 'Saved: ',
  saved: 'Saved',
  clickToolbarIconToOpenPanel: 'Click toolbar icon to open panel',
  activeTabNotFound: 'Active tab not found',
  noVisibleConversationFound: 'No visible conversation found',

  // AppShell
  expandSidebar: 'Expand sidebar',
  resizeSidebar: 'Resize sidebar',
  closeSettings: 'Close settings',
  sourceFilterAria: 'Source filter',
  conversationDetailAria: 'Conversation detail',
  deleteConfirmDialogAria: 'Delete conversations confirmation',

  // CapturedListSidebar
  settingsLabel: 'Settings',
  refreshList: 'Refresh list',
  collapseSidebar: 'Collapse sidebar',
  openSettingsAria: 'Open Settings',
  moreActionsAria: 'More actions coming soon',
  backToChatsAria: 'Back to chats',

  // BackupSection / SettingsScene
  importInApp: 'Import in App',

  // AboutSection
  aboutSectionAria: 'About SyncNos WebClipper',
  linksAria: 'Links',
  authorSectionAria: 'Author',
  donateSectionAria: 'Donate QR code',
} as const;

export type TranslationKey = keyof typeof en;

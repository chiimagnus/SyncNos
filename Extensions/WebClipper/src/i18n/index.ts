type Locale = 'en' | 'zh';

function detectLocale(): Locale {
  try {
    if (typeof navigator !== 'undefined') {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.startsWith('zh')) return 'zh';
    }
  } catch (_e) {
    // ignore
  }
  return 'en';
}

export const currentLocale: Locale = detectLocale();

const en = {
  // Settings sections
  section_backup_label: 'Backup',
  section_backup_desc: 'Export/import your database.',
  section_notion_label: 'Notion',
  section_notion_desc: 'OAuth + parent page for sync.',
  section_obsidian_label: 'Obsidian',
  section_obsidian_desc: 'Local REST API settings + sync status.',
  section_inpage_label: 'Inpage',
  section_inpage_desc: 'Inpage button visibility behavior.',
  section_about_label: 'About',
  section_about_desc: 'Project, author, and support links.',

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

  // usePopupCurrentPageCapture
  checkingCurrentPage: 'Checking current page...',
  unavailable: 'Unavailable',
  captureFailedFallback: 'Capture failed',
  fetchingDots: 'Fetching...',
  checkingDots: 'Checking...',
  savedPrefix: 'Saved: ',
  saved: 'Saved',

  // AppShell
  expandSidebar: 'Expand sidebar',
  resizeSidebar: 'Resize sidebar',
  closeSettings: 'Close settings',

  // CapturedListSidebar
  settingsLabel: 'Settings',
  refreshList: 'Refresh list',
  collapseSidebar: 'Collapse sidebar',

  // BackupSection / SettingsScene
  importInApp: 'Import in App',
} as const;

type TranslationKey = keyof typeof en;

const zh: { [K in TranslationKey]: string } = {
  // Settings sections
  section_backup_label: '备份',
  section_backup_desc: '导出/导入你的数据库。',
  section_notion_label: 'Notion',
  section_notion_desc: 'OAuth 授权 + 同步父页面。',
  section_obsidian_label: 'Obsidian',
  section_obsidian_desc: '本地 REST API 设置 + 同步状态。',
  section_inpage_label: '页面内按钮',
  section_inpage_desc: '页面内按钮显示行为设置。',
  section_about_label: '关于',
  section_about_desc: '项目、作者与支持链接。',

  // InpageSection
  inpageButtonHeading: '页面内按钮',
  inpageSupportedOnlyLabel: '仅在支持站点显示 Inpage 按钮',
  inpageSupportedOnlyHint: '切换后需刷新页面以生效。',

  // BackupSection
  databaseBackup: '数据库备份',
  exportZip: '导出 (Zip v2)',
  importDots: '导入\u2026',
  exportStatus: '导出：',
  lastExport: '上次导出：',
  importStatus: '导入：',
  statsConversations: '对话：',
  statsMessages: '消息：',
  statsMappings: '映射：',
  statsSettingsApplied: '应用设置：',

  // NotionOAuthSection
  notionOAuth: 'Notion OAuth',
  disconnect: '断开连接',
  connectingDots: '连接中\u2026',
  connect: '连接',
  parentPage: '父页面',
  clickRefresh: '点击刷新 \u2192',
  connectNotionFirst: '请先连接 Notion',

  // NotionAISection
  notionAI: 'Notion AI',
  modelIndex: '模型序号',
  save: '保存',
  reset: '重置',
  note: '备注',
  notionAiModelNote: '仅在 Notion AI 模型设置为自动时有效。Notion 中的菜单顺序可能会变化。',

  // ObsidianSettingsSection
  obsidianLocalRestApi: 'Obsidian 本地 REST API',
  baseUrl: '基础 URL',
  apiKey: 'API 密钥',
  authHeader: '认证头',
  test: '测试',
  status: '状态',
  obsidianInstallNote: '请先安装并配置 Obsidian Local REST API。',
  openSetupGuide: '打开配置指南',
  obsidianPaths: 'Obsidian 路径',
  aiChatsFolder: 'AI 对话文件夹',
  webClipperFolder: '网页剪藏文件夹',
  obsidianPathsNote: '相对于 Vault 的文件夹路径。支持嵌套文件夹，留空则使用默认路径。',

  // AboutSection
  macApp: 'Mac 应用',
  sourceCode: '源代码',
  changelog: '更新日志',
  mail: '邮件',
  versionPrefix: '版本',
  authorTagline: '时光机创造者~',

  // ConversationListPane
  allFilter: '全部',
  noConversations: '暂无对话。',
  // untitled is shared: used by ConversationListPane, ConversationDetailPane, and ConversationsScene
  untitled: '(无标题)',
  selectLabel: '选择',
  selectAll: '全选',
  copyFullMarkdown: '复制完整 Markdown',
  copied: '已复制',
  openChat: '打开原始对话',
  noLinkAvailable: '暂无链接',
  openOriginalChat: '打开原始对话',
  warningBadge: '警告',
  skipped: '跳过',
  deleteButton: '删除',
  exportButton: '导出',
  exportOptions: '导出选项',
  singleMarkdown: '合并 Markdown',
  multiMarkdown: '分开 Markdown',
  obsidianSync: 'Obsidian',
  obsidianSyncing: 'Obsidian...',
  notionSync: 'Notion',
  notionSyncing: 'Notion...',
  todayLabel: '今日：',
  totalLabel: '总计：',
  deleteConfirmTitle: '确认删除选中的对话？',
  deleteConfirmBody: '此操作不可撤销。',
  cancelButton: '取消',
  deletingDots: '删除中...',

  // ConversationDetailPane
  backButton: '返回',
  chatsTitle: '对话',
  detailTitle: '详情',
  messageRoleFallback: '消息',
  selectConversationHint: '从列表中选择一个对话',
  loadingDots: '加载中\u2026',
  noMessages: '暂无消息。',
  selectAConversation: '请选择一个对话。',

  // ConversationSyncFeedbackNotice
  phaseRunning: '同步中',
  phaseSuccess: '已完成',
  phasePartialFailed: '部分失败',
  phaseFailed: '失败',
  issuesSingular: '个问题',
  issuesPlural: '个问题',
  hideDetails: '隐藏详情',
  viewDetails: '查看详情',
  stagePrefix: '阶段：',
  currentPrefix: '当前：',
  syncDetails: '同步详情',
  dismissSyncFeedback: '关闭同步反馈',
  warningsHeading: '警告',
  conversationLabel: '对话',

  // PopupShell
  backToChats: '返回对话列表',
  openSettings: '打开设置',
  currentPageCannotBeCaptured: '当前页面无法捕获',
  moreActionsSoon: '更多功能即将推出',
  moreButton: '更多',

  // usePopupCurrentPageCapture
  checkingCurrentPage: '正在检测当前页面...',
  unavailable: '不支持',
  captureFailedFallback: '获取失败',
  fetchingDots: '获取中...',
  checkingDots: '检测中...',
  savedPrefix: '已保存：',
  saved: '已保存',

  // AppShell
  expandSidebar: '展开侧边栏',
  resizeSidebar: '调整侧边栏宽度',
  closeSettings: '关闭设置',

  // CapturedListSidebar
  settingsLabel: '设置',
  refreshList: '刷新列表',
  collapseSidebar: '收起侧边栏',

  // BackupSection / SettingsScene
  importInApp: '在 App 中导入',
};

const translations: Record<Locale, { [K in TranslationKey]: string }> = { en, zh };

export function t(key: TranslationKey): string {
  return translations[currentLocale][key];
}

/** Returns the conversation title, falling back to the localised "Untitled" string. */
export function formatConversationTitle(title: string | null | undefined): string {
  return String(title || '').trim() || t('untitled');
}

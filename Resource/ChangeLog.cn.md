# 更新日志

## v0.6.5.4 2025年11月12日

*Added*

- 主窗口行为改进：优化主窗口的显示和行为逻辑
- Open at Login 技术文档：新增开机自启功能的技术文档

*Changed*

- 移除用户指南功能：从应用中移除用户指南功能，简化界面
- 重构 FileCommands 命令组：更新菜单结构，使用 CommandGroup 替代原有实现
- 合并 NotionAuth 功能的 PR：整合 Notion 授权相关的功能改进

## v0.6.5.3 2025年11月12日

*Changed*

- 菜单栏改进：修复菜单设置中的未使用菜单项
- 日志增强：改进 LoggerService 和 HelperStatusBarController 的日志功能
- 配置清理：将 SharedDefaults 替换为 UserDefaults 以保持一致性
- 语言偏好处理：增强语言偏好设置的管理逻辑

## v0.6.5.2 2025年11月12日

*Changed*

- 登录项优化：增强 LoginItemViewModel 与 SettingsView 的交互逻辑
- 注册逻辑修复：更新登录项注册逻辑，提升稳定性
- 国际化更新：完善后台活动管理的本地化支持
- 标签文本优化：更新设置视图的标签文本以提高清晰度

## v0.6.5.1 2025年11月12日

*Changed*

- Notion 同步配置验证：增强配置验证逻辑
- 页面选择功能：为 Notion 集成添加页面选择功能
- UI 处理改进：优化 Notion 页面选择和界面处理逻辑

## v0.6.5 2025年11月11日

*Changed*

- 加载状态处理：改进加载状态的管理逻辑
- UI 界面简化：简化 NotionIntegrationView 的页面显示逻辑
- 页面选择增强：优化 Notion 页面选择 UI
- 同步模式清理：移除未使用的同步模式 UI 元素

## v0.6.4 2025年11月11日

*Added*

- 自定义剪贴板操作：在 EditCommands 中实现自定义剪贴板和选择命令
- StatusBarController：为 Helper 应用添加状态栏控制器

*Fixed*

- 逻辑顺序修复：修正配置检查 → 通过 → 发送通知 → 执行任务的流程
- Mac App Store 链接：更新文档中的 Mac App Store 链接
*Changed*

- 方案管理：清理方案管理 plist 文件，移除未使用的条目
- 项目配置：更新 SyncNosHelper 的项目配置

## v0.6.3 2025年11月11日

*Added*

- 菜单栏功能：实现 MenuBarViewModel 和 MenuBarView，增强同步功能
- 自定义菜单栏图标：为 SyncNos 应用添加自定义菜单栏图标
- 模块化处理：模块化命令处理，提升代码可维护性

*Changed*

- 项目配置：更新项目文件，包含文件系统同步异常配置
- Bundle Identifier 修复：更新 PRODUCT_BUNDLE_IDENTIFIER
- Helper 应用更新：调整应用图标处理，优化助手应用行为

## v0.6.2.3 2025年11月10日

*Added*

- 后台活动服务增强：增强后台活动服务以改进后台任务管理
- Helper 应用重构：重构 SyncNosHelper 应用结构并移除 ContentView
- 文件系统同步：为 SyncNosHelper 目标添加文件系统同步异常配置
- 后台模式：启用应用程序的后台模式

*Changed*

- 后台活动集成：实现用于自动同步的后台活动服务
- 数据源选择：重构 MainListView 中的数据源选择逻辑
- Apple Books 集成：添加按钮以在 AppleBooksListView 中打开 Apple Books 笔记
- 日志协议更新：更新日志协议并修复 DatabaseQueryService 中的调试日志

## v0.6.2.2 2025年11月10日

*Added*

- 状态栏控制器：为 Helper 应用添加 HelperStatusBarController
- SharedDefaults 迁移：继续迁移到 SharedDefaults 以管理用户偏好
- 助手应用集成：实现用于后台同步的助手应用集成

*Changed*

- 后台活动管理：使用线程安全的状态处理增强后台活动管理
- 设置视图清理：移除未使用的状态文本
- 后台活动服务：改进后台活动服务的日志记录
- 后台活动管理：在 ViewModel 中简化后台活动管理

## v0.6.2.1 2025年11月09日

*Added*

- 国际化支持：为后台活动管理添加 i18n 支持
- 状态栏交互：添加 HelperStatusBarController 用于管理状态栏交互
- SharedDefaults 迁移：将用户默认设置迁移到 SharedDefaults 以改进数据管理

*Changed*

- 后台模式：更新仅后台模式的 plist 键
- 后台活动服务：移除 HelperLauncher，增强后台活动服务
- 后台活动管理：改进后台活动服务助手管理

## v0.6.2 2025年11月09日

*Added*

- 后台活动服务增强：增强 BackgroundActivityService 以改进后台任务管理
- Helper 应用重构：重构 SyncNosHelper 应用结构并移除 ContentView
- 文件系统同步：为 SyncNosHelper 目标添加文件系统同步异常配置
- 后台模式：启用应用程序的后台模式
- MainListView 重构：重构 MainListView 中的数据源选择逻辑

*Changed*

- 后台活动集成：实现用于自动同步的后台活动服务
- Apple Books 集成：添加按钮以在 AppleBooksListView 中打开 Apple Books 笔记
- 用户通知集成：从 AppDelegate 和 LoginItemViewModel 中移除用户通知集成
- 日志记录增强：改进 LoggerService 中的日志记录机制
- CLAUDE.md 更新：更新文档以提高清晰度并添加开发命令

## v0.6.1 2025年11月07日

*Added*

- 通知处理增强：增强 AppDelegate 中的通知处理
- 用户通知集成：为应用状态更新集成用户通知
- Open at Login 技术文档：添加开机自启功能的技术文档

*Changed*

- 登录项服务增强：增强 LoginItemService 并迁移旧版助手注册
- SyncNosHelper 应用更新：移除 ContentView 并更新初始化
- 项目配置：更新项目配置以支持登录项功能

## v0.6.0 2025年11月07日

*Added*

- 登录项服务实现：实现 LoginItemService 并集成到设置
- SyncNosHelper 应用：添加 SyncNosHelper 应用的初始实现
- 后台登录项状态检索：改进后台登录项状态检索

*Changed*

- 移除 LoginHelper 应用：移除 LoginHelper 应用和相关资源
- 登录项状态：改进后台登录项状态检索
- 项目配置：更新项目配置以支持新的登录项实现

## v0.5.11.6 2025年11月07日

*Added*

- 自动保存功能：在 AppleBooks 和 GoodLinks 设置视图中实现自动保存功能

*Changed*

- 文档更新：更新 CLAUDE.md 文档
- 项目维护：项目配置和构建优化

## v0.5.11.5 2025年11月06日

*Changed*

- 通知处理：改进 AppleBooks 和 GoodLinks 视图模型中的通知处理
- 自动同步优化：更新 AutoSyncService 以包含所有链接在同步过程中
- 同步触发器：为 AutoSyncService 添加按源的即时触发器

## v0.5.11.4 2025年11月06日

*Added*

- 失败任务管理：在 SyncQueueView 中添加失败任务部分以改进任务管理
- 同步队列增强：增强同步队列管理以跟踪失败任务

*Changed*

- 错误处理：增强 GoodLinksQueryService 中的错误处理
- UI 更新：用表情符号按钮更新 MainListView 工具栏以区分内容源

## v0.5.11.3 2025年11月05日

*Changed*

- 通知处理：改进 AppleBooks 和 GoodLinks 视图模型中的通知处理
- 自动同步优化：更新 AutoSyncService 以包含所有链接在同步过程中
- 同步触发器：为 AutoSyncService 添加按源的即时触发器

## v0.5.11.2 2025年11月05日

*Changed*

- UI 改进：用表情符号按钮更新 MainListView 工具栏以区分内容源

## v0.5.11.1 2025年11月04日

*Added*

- 同步任务导航：增强同步任务选择和导航功能
- 同步队列导航：实现从同步队列导航到同步任务详情的功能

*Changed*

- 日期处理：更新 Notion 同步服务中的日期处理以使用系统时区
- 文档更新：更新 ChangeLog

## v0.5.11 2025年11月4日

*Changed*

- Notion 集成优化：改进 NotionHelperMethods 中的 iBooks 链接编码，提升链接处理准确性。
- 高亮处理增强：优化高亮链接和元数据处理逻辑。
- 同步策略更新：更新 AppleBooksSyncStrategy 以使用基于令牌的高亮映射。
- 代码清理：移除 NotionHelperMethods 中过时的无效方法。

## v0.5.10.6 2025年11月4日

*Changed*

- Notion 高亮操作优化：精简 NotionHighlightOperations 中的子块元数据处理流程。
- 元数据处理增强：为 NotionHelperMethods 添加高亮元数据注释功能。
- GoodLinks 同步改进：通过基于令牌的更新增强 GoodLinks 同步机制。
- 队列管理优化：实现同步队列管理的延迟清理机制。
- 同步触发机制：同步成功后在 AppleBooks 和 GoodLinks 中触发重新计算。

## v0.5.10.5 2025年11月3日

*Added*

- 同步报告文档：新增 Apple Books 和 GoodLinks 同步到 Notion 的详细报告文档。

*Changed*

- 增量同步优化：改进 GoodLinksSyncService 中的增量同步机制。
- 页面创建改进：优化 GoodLinks 页面创建和高亮同步流程。
- 冲突处理增强：优化 GoodLinks 同步并增强冲突处理能力。
- 用户界面统一：统一选择占位符视图以改善用户体验。
- Notion 同步增强：通过添加源参数改进 Notion 同步功能。

## v0.5.10.4 2025年11月3日

*Changed*

- Notion 数据库管理：增强 Notion 数据库属性管理功能。
- 项目文档更新：更新 CLAUDE.md 中的项目概览和结构说明。

## v0.5.10.3 2025年11月3日

*Added*

- 国际化功能：继续完善应用的多语言支持。

*Changed*

- 界面布局优化：增强 InfoHeaderCardView 和 SyncQueueView 的布局设计。

## v0.5.10.2 2025年11月3日

*Changed*

- 自动同步增强：优化 AutoSyncService 以支持按源独立同步控制。

## v0.5.10.1 2025年11月3日

*Added*

- 国际化支持：增强应用的国际化功能。
- 空状态视图：实现 EmptyStateView 以改善用户体验。
- 主列表功能：为主列表视图添加排序和筛选选项，支持 Apple Books 和 GoodLinks。

*Changed*

- 书籍显示改进：优化 AppleBooks 视图中的书籍标题和作者显示。
- 界面文本优化：更新和简化各个视图组件的标签文本。
- 排序键显示：更新 BookListSortKey 的显示名称以提升清晰度。
- 同步队列界面：注释 SyncQueueView 中的导航标题和工具栏。
- 版本管理：更新项目版本号至 0.5.10。

*Fixed*

- 显示问题修复：修复 AppleBooksDetailView 中的作者名显示和 MainListView 中的数量统计。

## v0.5.10 2025年11月2日

*Added*

- 新增功能：为 Apple Books 和 GoodLinks 实现高亮颜色管理功能。

*Changed*

- 架构重构：将命令结构模块化，拆分为独立的命令文件以提高可维护性。

## v0.5.9.3 2025年11月2日

*Added*

- 同步队列管理：实现同步队列管理和 UI 界面，为任务添加源标识徽章。
- 全局并发控制：实现全局并发限制器以优化同步操作性能。

*Changed*

- API 优化：改进 Notion API 的读写限流机制，提升同步稳定性。
- 同步队列重构：优化 SyncQueueView 的布局和功能，集成到 InfoHeaderCardView 和 MainListView 中。
- 并发控制增强：在 AppleBooksDetailViewModel 和 GoodLinksViewModel 中集成并发限制器。
- 界面改进：移除同步队列窗口，更新同步队列布局和背景样式。
- 日志机制：改进 LoggerService 中的日志记录机制。
- 状态管理：优化 GoodLinksViewModel 中的同步状态管理。

## v0.5.9.2 2025年10月30日

*Added*

- 同步队列：实现同步队列管理和 UI 界面。

*Changed*

- 界面优化：统一 AppleBooksDetailView 和 GoodLinksDetailView 中的工具栏结构。
- 布局改进：重新组织 LogWindow 布局和工具栏集成，更新 SyncQueueView 布局和导航。

## v0.5.9.1 2025年10月30日

*Changed*

- 滚动体验优化：改进 AppleBooksDetailView 和 GoodLinksDetailView 中的滚动行为。
- 界面微调：增强 ArticleContentCardView 的可选展开状态绑定，禁用文本选择以提升用户体验。

## v0.5.8 2025年10月30日

*Added*

- 国际化支持：为应用添加多语言国际化支持。
- 同步监控：实现同步活动监控和应用终止处理。
- 内容增强：增强 ArticleContentCardView 以支持自定义内容插槽，添加多选占位符视图的标题和同步进度消息。
- Fallback 机制：为 GoodLinksDetailView 添加 fallback 内容处理。

*Changed*

- 界面改进：增强 MainListView 布局和样式，更新 AppleBooksDetailView 和 GoodLinksDetailView 中的图标以保持一致性。
- 链接显示：更新 GoodLinksDetailView 中的链接颜色以提高可见性，修正 fallback 消息的清晰度。
- 许可证更新：更新 README 文件中的许可证从 GPL-3.0 到 AGPL-3.0。

## v0.5.7.2 2025年10月28日

*Changed*

- 界面优化：更新 AppCommands 菜单图标以提高清晰度，在 FiltetSortBar 和 AppCommands 中用 Button 替换 Toggle 以进行笔记筛选，保持 ViewModels 中高亮选择的紧凑遮罩。
- 功能增强：在 ViewModels 中实现颜色筛选选择，统一筛选与排序体验。

## v0.5.7.1 2025年10月28日

*Added*

- 全局设置：在 AppleBooks 和 GoodLinks 视图模型中同步全局高亮设置，在 AppCommands 中添加全局高亮排序和筛选选项。

*Changed*

- 状态管理优化：优化 UserDefaults 使用并在 ViewModels 中增强防抖机制，增强 GoodLinksViewModel 中的同步通知，改进应用重启流程。
- 文档更新：移除 ViewModels 改进计划文档，精简项目文档结构。

## v0.5.7 2025年10月28日

*Changed*

- 架构重构：简化 AppCommands 结构，移除详情视图中未使用的重置筛选功能，更新详情视图中的工具栏项目位置。
- 组件更新：用 FiltetSortBar 替换 FilterBar 在 AppleBooks 和 GoodLinks 详情视图中，增强并发性和服务级别的 Sendable 合规性。

## v0.5.6.7 2025年10月28日

*Changed*

- 代码优化：从 AppleBookDetailViewModel 中移除 syncToNotion 方法，将高亮筛选和排序合并到 GoodLinksViewModel 中以提升一致性。
- 功能增强：在 GoodLinksDetailViewModel 和 UI 组件中增强排序功能，添加 GoodLinksDetailViewModel 和 FilterBar 以增强筛选选项。

## v0.5.6.6 2025年10月27日

*Changed*

- 解析优化：增强 AppleBooksLocationParser 中的 EPUB CFI 解析能力，优化 AppleBookDetailView 中的高亮排序机制。
- 界面改进：细化排序字段显示，修正 AppleBookDetailView 中的语法错误，简化排序选项并隐藏菜单指示器。

## v0.5.6.5 2025年10月26日

*Changed*

- 交互改进：为 AppleBooksListView 和 GoodLinksListView 实现选择命令，更新 AppCommands 中的取消选择按钮图标。

## v0.5.6.3 2025年10月25日

*Added*

- 深度集成：为 Apple Books 和 GoodLinks 添加上下文菜单选项以直接打开应用，为 GoodLinks 添加深度链接功能。

*Changed*

- UI 改进：在 AppleBooksListView 和 GoodLinksListView 中优化最后同步时间显示逻辑，提升用户体验反馈。

## v0.5.6.2 2025年10月24日

*Added*

- Notion 集成增强：为 Notion 数据库添加"最后同步时间"属性并更新页面属性，提供更详细的同步状态信息。

## v0.5.6.1 2025年10月24日

*Changed*

- 数据库管理：在 NotionService 中实现数据库创建的序列化机制，确保数据库操作的一致性和稳定性。

## v0.5.5.1 2025年10月24日

*Changed*

- 文档调整：回滚计划文档，保持项目文档的简洁性和实用性。

## v0.5.5 2025年10月17日

*Added*

- 同步体验改进：增强同步反馈并为批量同步添加进度跟踪，显示选中项目的上次同步时间。

*Changed*

- UI 清理与优化：移除冗余的同步按钮与相关上下文菜单，简化 `MainListView` 布局并改进项选择反馈。
- 并发控制统一：统一并强化批量同步的并发控制逻辑，提升同步稳定性与一致性。

## v0.5.4 2025年10月17日

*Added*

- 批量同步：为 Apple Books 与 GoodLinks 添加对选中项的批量同步功能，提升操作效率。
- 筛选与排序：实现 Apple Books 与 GoodLinks 的过滤与排序选项，并扁平化过滤菜单结构以简化操作。

*Fixed*

- 修复批量同步中错误日志写入线程问题，确保在主线程安全记录日志。

## v0.5.3.1 2025年10月17日

*Changed*

- 功能实验：为文章和高亮视图添加 Markdown 支持（后续版本中回滚）。

## v0.5.3 2025年10月15日

*Added*

- Sign in with Apple 后端增强：实现 Apple ID token 验证、nonce 支持以及更安全的 JTI 存储，改进 Apple 登录流程。

*Changed*

- 后端重构与类型改进：更新用户模型与安全依赖以改善类型处理与安全性。

*Docs*

- 新增 Sign in with Apple 开发指南并更新 README 与相关文档。

## v0.5.2 2025年10月15日

*Added*

- 日志与调试：新增日志窗口及导出/分享功能，改进日志筛选与级别选项，增强调试体验。

*Changed*

- 界面微调：若干设置视图标签与图标优化，提升可读性与一致性。

## v0.5.1 2025年10月15日

*Added*

- 后端与认证：初始化 FastAPI 后端骨架，添加用户认证與 Apple OAuth 支持（后端初始实现）。

*Changed*

- 账户与权限：改善 `AccountViewModel` 的 token 获取逻辑并为项目添加 Apple Sign In 权限配置（entitlements）。

*Docs*

- 更新 AppleBooks/GoodLinks 的本地化字符串与相关文档、Changelog 条目。

## v0.4.15 2025年10月12日

*Changed*

- 设置重构：将设置拆分为按源（AppleBooks/GoodLinks）管理，移动数据授权按钮到对应源设置，移除全局 autoSync，采用每源开关与更清晰的导航与图标。

*Fixed*

- Notion 集成修复：修复 Notion 相关 ViewModel 使用通用 `databaseIdForSource` 的问题，改进 per-source 配置使用流程。

## v0.4.14 2025年10月12日

*Changed*

- Notion 配置增强：为 AppleBooks 与 GoodLinks 提供可选的数据库 ID 配置，重构 `NotionConfigStore` 与 `NotionService` 以改善配置管理。
- GoodLinks 改进：重构 GoodLinks 列表的排序与筛选逻辑，并将工具栏移至主列表以统一体验；若干视图与枚举重命名与清理。

## v0.4.13 2025年10月11日

*Added*

- Notion 功能扩展（实验性）：引入页面级数据库映射与子数据库查找功能、feature flag 以控制子块/子库查找行为；增加 Notion API 版本升级与限流重试支持。
- 并发同步：`AutoSyncService` 支持并发同步（最高 10 本书），提高同步吞吐量与稳定性。

## v0.4.12.1 2025年10月11日

*Fixed*

- 修复 MainList 背景处理与默认背景设置，完善 GoodLinks 的排序与筛选实现。

*Changed*

- ViewModel 与性能优化：抽象并注入时间戳存储（`SyncTimestampStore`）、移除未使用导入、清理多个 ViewModel；使用 Combine 优化 IAP 状态监听与移除冗余的对象变更通知。

## v0.4.12 2025年10月11日

*Added*

- AppleBooks 功能：为高亮和书籍实现排序与筛选功能，并将相关菜单结构简化以提升可用性。

*Changed*

- 状态管理重构：将排序/筛选状态从 `@AppStorage` 替换为通过 `UserDefaults` 注入以简化状态依赖与测试。
- 复用性改进：提取共享 UI 组件以减少重复并对若干视图做重构和项目文件更新。

## v0.4.11.2 2025年10月8日

*Changed*

- Notion 上传改进：将单条截断逻辑替换为按 ≤1500 字分块上传，Highlight/Note/metadata 结构改为父块 + 子块、多个兄弟 bullet 与 metadata 子块，避免 perbookdb 模式下单条笔记因字数过大而阻塞同步。

## v0.4.11.1 2025年10月8日

*Changed*

- Notion 集成优化：修复 Notion 的新建页面插入逻辑，在 `NotionPageOperations` 中采用新的 children 数组结构插入方式，提升页面创建的稳定性。

## v0.4.11 2025年10月8日

*Added*

- 国际化布局：为国际化设置添加布局支持，优化应用在不同语言环境下的显示效果。

*Changed*

- 状态管理：优化 GoodLinks 列表的状态管理逻辑，提升页面响应性能。

## v0.4.10 2025年10月7日

*Changed*

- 同步机制优化：重构同步相关逻辑，优化应用启动时的初始化流程。

## v0.4.9.7 2025年10月7日

*Changed*

- API 调用优化：改进 Notion API 的并发调用策略，提升同步性能。

## v0.4.9.6 2025年10月7日

*Fixed*

- 错误处理：修复同步过程中的错误处理机制，确保应用稳定性。

## v0.4.9.5 2025年10月6日

*Changed*

- 性能优化：优化数据库查询性能，减少应用内存占用。

## v0.4.9.4 2025年10月6日

*Fixed*

- 同步状态：修复同步状态显示问题，确保状态准确性。

## v0.4.9.3 2025年10月6日

*Changed*

- UI 优化：改进用户界面显示效果，提升用户体验。

## v0.4.9.2 2025年10月6日

*Fixed*

- 数据同步：修复 GoodLinks 数据同步中的异常情况。

## v0.4.9.1 2025年10月6日

*Fixed*

- 列表显示：修复 Apple Books 列表的显示问题。

## v0.4.9 2025年10月6日

*Added*

- 同步状态：新增同步状态显示功能，实时反馈同步进度。

## v0.4.8.4 2025年10月6日

*Changed*

- 架构优化：优化应用架构，提升代码可维护性。

## v0.4.8.3 2025年10月6日

*Fixed*

- 内存优化：修复内存泄漏问题，优化应用性能。

## v0.4.8.2 2025年10月5日

*Changed*

- 配置管理：改进配置管理机制，提升应用稳定性。

## v0.4.8.1 2025年10月5日

*Fixed*

- 数据库访问：修复数据库访问的异常情况。

## v0.4.8 2025年10月5日

*Added*

- 高级设置：新增高级设置选项，提供更多自定义功能。

*Changed*

- 界面重构：重构应用界面，提升用户交互体验。

## v0.4.7 2025年10月4日

*Added*

- 快捷键支持：为常用功能添加快捷键支持。

## v0.4.6.1 2025年10月4日

*Fixed*

- 同步优化：修复同步过程中的性能问题。

## v0.4.6 2025年10月4日

*Changed*

- 界面优化：改进应用界面设计，提升视觉效果。

## v0.4.5 2025年10月4日

*Added*

- 数据导出：新增数据导出功能。

## v0.4.4 2025年10月3日

*Changed*

- 性能提升：优化应用启动速度和响应性能。

## v0.4.3 2025年10月3日

*Added*

- 新增功能：实现用户反馈功能。

## v0.4.2 2025年10月2日

*Fixed*

- Bug 修复：修复多个已知问题。

## v0.4.1 2025年10月2日

*Added*

- 设置优化：新增应用设置选项。

## v0.4.0 2025年10月1日

*Added*

- 重大功能：实现主要功能模块。

## v0.3.8 2025年10月1日

*Added*

- 同步功能：实现基础同步功能。

## v0.3.9 2025年10月1日

*Added*

- 新增赞助项：如果你觉得项目不错，可以通过赞助支持我们。

## v0.3.7.2 2025年9月30日

*Changed*

- 文档更新：完善用户指南内容，添加更多使用说明和常见问题解答。

## v0.3.7.1 2025年9月29日

*Fixed*

- Bug 修复：修复快捷键功能中的冲突问题。

## v0.3.7 2025年9月29日

*Added*

- 新增"一键同步当前书籍"快捷键，并提供详细的用户指南以帮助快速上手。

## v0.3.6 2025年9月28日

## v0.3.5 2025年9月26日

*Added*

- 错误恢复：实现错误恢复机制，提升应用稳定性。

## v0.3.4 2025年9月26日

*Changed*

- 用户体验：优化用户交互流程，提升整体体验。

## v0.3.3 2025年9月26日

*Fixed*

- 性能优化：修复性能瓶颈，提升应用响应速度。

## v0.3.2 2025年9月26日

*Added*

- 数据验证：增强数据验证机制，确保数据完整性。

## v0.3.1 2025年9月24日

*Added*

- 核心功能：实现 Apple Books 与 GoodLinks 的基本同步功能。

## v0.2.13 2025年9月24日

*Changed*

- 代码重构：优化代码结构，提升可维护性。

## v0.2.12 2025年9月23日

*Fixed*

- Bug 修复：修复同步过程中的异常情况。

## v0.2.11 2025年9月23日

*Added*

- 状态管理：实现应用状态管理机制。

## v0.2.10 2025年9月22日

*Changed*

- API 集成：优化第三方 API 集成逻辑。

## v0.2.9 2025年9月19日

*Added*

- 基础功能：实现基本的数据读取功能。

## v0.2.8 2025年9月19日

*Fixed*

- 数据库访问：修复数据库访问权限问题。

## v0.2.7 2025年9月19日

*Changed*

- 项目配置：优化项目构建配置。

## v0.2.6 2025年9月17日

*Added*

- 数据模型：建立核心数据模型结构。

## v0.2.5 2025年9月16日

*Changed*

- 架构设计：完善应用架构设计。

## v0.2.4 2025年9月13日

*Added*

- 基础框架：建立应用基础框架结构。

## v0.2.3 2025年9月12日

*Fixed*

- 依赖管理：修复依赖库版本冲突问题。

## v0.2.2 2025年9月11日

*Added*

- 开发环境：配置开发环境和构建工具。

## v0.2.1 2025年9月11日

*Added*

- 项目初始化：创建项目基础结构和配置文件。

## v0.1.2 2025年9月11日

*Added*

- 概念验证：实现基本概念的原型验证。

## v0.1.1 2025年9月10日

*Added*

- 技术调研：完成技术方案调研和可行性分析。

## v0.1.0 2025年9月10日

*Added*

- 项目启动：SyncNos 项目初始化，确定项目目标和技术栈。

## v0.1 2025年9月10日

*Added*

- 项目立项：项目概念设计和初步规划。


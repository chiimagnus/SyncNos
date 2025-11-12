[ChangeLog-Chinese Version 中文版更新日志](ChangeLog.cn.md)

## v0.5.10 November 2, 2025

*Added*

- New Feature: Implemented highlight color management functionality for Apple Books and GoodLinks.

*Changed*

- Architecture Refactor: Modularized command structure, split into independent command files for improved maintainability.

## v0.5.9.3 November 2, 2025

*Added*

- Sync Queue Management: Implemented sync queue management and UI interface, added source identification badges for tasks.
- Global Concurrency Control: Implemented global concurrency limiter to optimize sync operation performance.

*Changed*

- API Optimization: Improved Notion API read/write rate limiting mechanism, enhanced sync stability.
- Sync Queue Refactor: Optimized SyncQueueView layout and functionality, integrated into InfoHeaderCardView and MainListView.
- Concurrency Control Enhancement: Integrated concurrency limiter in AppleBooksDetailViewModel and GoodLinksViewModel.
- UI Improvements: Removed sync queue window, updated sync queue layout and background styles.
- Logging Mechanism: Improved logging mechanism in LoggerService.
- State Management: Optimized sync state management in GoodLinksViewModel.

## v0.5.9.2 October 30, 2025

*Added*

- Sync Queue: Implemented sync queue management and UI interface.

*Changed*

- UI Optimization: Unified toolbar structure in AppleBooksDetailView and GoodLinksDetailView.
- Layout Improvements: Reorganized LogWindow layout and toolbar integration, updated SyncQueueView layout and navigation.

## v0.5.9.1 October 30, 2025

*Changed*

- Scroll Experience Optimization: Improved scroll behavior in AppleBooksDetailView and GoodLinksDetailView.
- UI Fine-tuning: Enhanced optional expand state binding in ArticleContentCardView, disabled text selection to improve user experience.

## v0.5.8 October 30, 2025

*Added*

- Internationalization Support: Added multi-language internationalization support for the application.
- Sync Monitoring: Implemented sync activity monitoring and application termination handling.
- Content Enhancement: Enhanced ArticleContentCardView to support custom content slots, added titles and sync progress messages for multi-selection placeholder views.
- Fallback Mechanism: Added fallback content handling for GoodLinksDetailView.

*Changed*

- UI Improvements: Enhanced MainListView layout and style, updated icons in AppleBooksDetailView and GoodLinksDetailView for consistency.
- Link Display: Updated link colors in GoodLinksDetailView for better visibility, clarified fallback message clarity.
- License Update: Updated license in README file from GPL-3.0 to AGPL-3.0.

## v0.5.7.2 October 28, 2025

*Changed*

- UI Optimization: Updated AppCommands menu icons for better clarity, replaced Toggle with Button in FiltetSortBar and AppCommands for note filtering, maintained compact mask for highlight selection in ViewModels.
- Feature Enhancement: Implemented color filter selection in ViewModels, unified filtering and sorting experience.

## v0.5.7.1 October 28, 2025

*Added*

- Global Settings: Synchronized global highlight settings in AppleBooks and GoodLinks view models, added global highlight sorting and filtering options in AppCommands.

*Changed*

- State Management Optimization: Optimized UserDefaults usage and enhanced debounce mechanism in ViewModels, enhanced sync notifications in GoodLinksViewModel, improved application restart process.
- Documentation Update: Removed ViewModels improvement plan document, streamlined project documentation structure.

## v0.5.7 October 28, 2025

*Changed*

- Architecture Refactor: Simplified AppCommands structure, removed unused reset filter functionality in detail views, updated toolbar item positions in detail views.
- Component Update: Replaced FilterBar with FiltetSortBar in AppleBooks and GoodLinks detail views, enhanced concurrency and service-level Sendable compliance.

## v0.5.6.7 October 28, 2025

*Changed*

- Code Optimization: Removed syncToNotion method from AppleBookDetailViewModel, merged highlight filtering and sorting into GoodLinksViewModel to improve consistency.
- Feature Enhancement: Enhanced sorting functionality in GoodLinksDetailViewModel and UI components, added GoodLinksDetailViewModel and FilterBar to enhance filtering options.

## v0.5.6.6 October 27, 2025

*Changed*

- Parsing Optimization: Enhanced EPUB CFI parsing capability in AppleBooksLocationParser, optimized highlight sorting mechanism in AppleBookDetailView.
- UI Improvements: Refined sorting field display, corrected syntax errors in AppleBookDetailView, simplified sorting options and hidden menu indicators.

## v0.5.6.5 October 26, 2025

*Changed*

- Interaction Improvements: Implemented selection commands for AppleBooksListView and GoodLinksListView, updated deselect button icon in AppCommands.

## v0.5.6.3 October 25, 2025

*Added*

- Deep Integration: Added context menu options for Apple Books and GoodLinks to directly open applications, added deep linking functionality for GoodLinks.

*Changed*

- UI Improvements: Optimized last sync time display logic in AppleBooksListView and GoodLinksListView, enhanced user experience feedback.

## v0.5.6.2 October 24, 2025

*Added*

- Notion Integration Enhancement: Added "Last Sync Time" property to Notion database and updated page properties, providing more detailed sync status information.

## v0.5.6.1 October 24, 2025

*Changed*

- Database Management: Implemented serialized database creation mechanism in NotionService, ensuring consistency and stability of database operations.

## v0.5.5.1 October 24, 2025

*Changed*

- Documentation Adjustment: Rolled back planning documents, maintained project documentation conciseness and practicality.

## v0.5.5 October 17, 2025

*Added*

- Sync Experience Improvement: Enhanced sync feedback and added progress tracking for batch sync, displayed last sync time for selected items.

*Changed*

- UI Cleanup and Optimization: Removed redundant sync buttons and related context menus, simplified `MainListView` layout and improved item selection feedback.
- Concurrency Control Unification: Unified and strengthened batch sync concurrency control logic, improved sync stability and consistency.

## v0.5.4 October 17, 2025

*Added*

- Batch Sync: Added batch sync functionality for selected items in Apple Books and GoodLinks, improved operation efficiency.
- Filtering and Sorting: Implemented filtering and sorting options for Apple Books and GoodLinks, flattened filter menu structure to simplify operations.

*Fixed*

- Fixed error log writing thread issue in batch sync, ensured safe log recording on main thread.

## v0.5.3.1 October 17, 2025

*Changed*

- Feature Experiment: Added Markdown support for article and highlight views (rolled back in later versions).

## v0.5.3 October 15, 2025

*Added*

- Sign in with Apple Backend Enhancement: Implemented Apple ID token verification, nonce support, and more secure JTI storage, improved Apple login flow.

*Changed*

- Backend Refactor and Type Improvements: Updated user models and security dependencies to improve type handling and security.

*Docs*

- Added Sign in with Apple development guide and updated README and related documentation.

## v0.5.2 October 15, 2025

*Added*

- Logging and Debugging: Added log window with export/share functionality, improved log filtering and level options, enhanced debugging experience.

*Changed*

- UI Fine-tuning: Optimized labels and icons in several settings views, improved readability and consistency.

## v0.5.1 October 15, 2025

*Added*

- Backend and Authentication: Initialized FastAPI backend skeleton, added user authentication and Apple OAuth support (backend initial implementation).

*Changed*

- Account and Permissions: Improved token retrieval logic in `AccountViewModel` and added Apple Sign In permission configuration (entitlements) to the project.

*Docs*

- Updated AppleBooks/GoodLinks localization strings and related documentation, Changelog entries.

## v0.4.15 October 12, 2025

*Changed*

- Settings Refactor: Split settings into per-source (AppleBooks/GoodLinks) management, moved data authorization buttons to corresponding source settings, removed global autoSync, adopted per-source switches with clearer navigation and icons.

*Fixed*

- Notion Integration Fix: Fixed issue with Notion-related ViewModels using generic `databaseIdForSource`, improved per-source configuration usage flow.

## v0.4.14 October 12, 2025

*Changed*

- Notion Configuration Enhancement: Provided optional database ID configuration for AppleBooks and GoodLinks, refactored `NotionConfigStore` and `NotionService` to improve configuration management.
- GoodLinks Improvements: Refactored sorting and filtering logic for GoodLinks list, moved toolbar to main list for unified experience; renamed and cleaned up several views and enums.

## v0.4.13 October 11, 2025

*Added*

- Notion Feature Extension (Experimental): Introduced page-level database mapping and sub-database lookup functionality, feature flag to control sub-block/sub-database lookup behavior; added Notion API version upgrade and rate limit retry support.
- Concurrent Sync: `AutoSyncService` supports concurrent sync (up to 10 books), improved sync throughput and stability.

## v0.4.12.1 October 11, 2025

*Fixed*

- Fixed MainList background handling and default background settings, completed GoodLinks sorting and filtering implementation.

*Changed*

- ViewModel and Performance Optimization: Abstracted and injected timestamp storage (`SyncTimestampStore`), removed unused imports, cleaned up multiple ViewModels; used Combine to optimize IAP state monitoring and remove redundant object change notifications.

## v0.4.12 October 11, 2025

*Added*

- AppleBooks Features: Implemented sorting and filtering functionality for highlights and books, simplified related menu structure to improve usability.

*Changed*

- State Management Refactor: Replaced sorting/filtering state from `@AppStorage` with injection through `UserDefaults` to simplify state dependencies and testing.
- Reusability Improvements: Extracted shared UI components to reduce duplication and refactored several views and project file updates.

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


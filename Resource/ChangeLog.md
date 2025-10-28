## v0.5.7.3
新增了一个GitHub action。

## v0.5.7.2

*Changed*

- 界面优化：更新 AppCommands 菜单图标以提高清晰度，在 FiltetSortBar 和 AppCommands 中用 Button 替换 Toggle 以进行笔记筛选，保持 ViewModels 中高亮选择的紧凑遮罩。
- 功能增强：在 ViewModels 中实现颜色筛选选择，统一筛选与排序体验。

## v0.5.7.1

*Added*

- 全局设置：在 AppleBooks 和 GoodLinks 视图模型中同步全局高亮设置，在 AppCommands 中添加全局高亮排序和筛选选项。

*Changed*

- 状态管理优化：优化 UserDefaults 使用并在 ViewModels 中增强防抖机制，增强 GoodLinksViewModel 中的同步通知，改进应用重启流程。
- 文档更新：移除 ViewModels 改进计划文档，精简项目文档结构。

## v0.5.7

*Changed*

- 架构重构：简化 AppCommands 结构，移除详情视图中未使用的重置筛选功能，更新详情视图中的工具栏项目位置。
- 组件更新：用 FiltetSortBar 替换 FilterBar 在 AppleBooks 和 GoodLinks 详情视图中，增强并发性和服务级别的 Sendable 合规性。

## v0.5.6.7

*Changed*

- 代码优化：从 AppleBookDetailViewModel 中移除 syncToNotion 方法，将高亮筛选和排序合并到 GoodLinksViewModel 中以提升一致性。
- 功能增强：在 GoodLinksDetailViewModel 和 UI 组件中增强排序功能，添加 GoodLinksDetailViewModel 和 FilterBar 以增强筛选选项。

## v0.5.6.6

*Changed*

- 解析优化：增强 AppleBooksLocationParser 中的 EPUB CFI 解析能力，优化 AppleBookDetailView 中的高亮排序机制。
- 界面改进：细化排序字段显示，修正 AppleBookDetailView 中的语法错误，简化排序选项并隐藏菜单指示器。

## v0.5.6.5

*Changed*

- 交互改进：为 AppleBooksListView 和 GoodLinksListView 实现选择命令，更新 AppCommands 中的取消选择按钮图标。

## v0.5.6.3

*Added*

- 深度集成：为 Apple Books 和 GoodLinks 添加上下文菜单选项以直接打开应用，为 GoodLinks 添加深度链接功能。

*Changed*

- UI 改进：在 AppleBooksListView 和 GoodLinksListView 中优化最后同步时间显示逻辑，提升用户体验反馈。

## v0.5.6.2

*Added*

- Notion 集成增强：为 Notion 数据库添加"最后同步时间"属性并更新页面属性，提供更详细的同步状态信息。

## v0.5.6.1

*Changed*

- 数据库管理：在 NotionService 中实现数据库创建的序列化机制，确保数据库操作的一致性和稳定性。

## v0.5.5.1

*Changed*

- 文档调整：回滚计划文档，保持项目文档的简洁性和实用性。

## v0.5.5

*Added*

- 同步体验改进：增强同步反馈并为批量同步添加进度跟踪，显示选中项目的上次同步时间。

*Changed*

- UI 清理与优化：移除冗余的同步按钮与相关上下文菜单，简化 `MainListView` 布局并改进项选择反馈。
- 并发控制统一：统一并强化批量同步的并发控制逻辑，提升同步稳定性与一致性。

## v0.5.4

*Added*

- 批量同步：为 Apple Books 与 GoodLinks 添加对选中项的批量同步功能，提升操作效率。
- 筛选与排序：实现 Apple Books 与 GoodLinks 的过滤与排序选项，并扁平化过滤菜单结构以简化操作。

*Fixed*

- 修复批量同步中错误日志写入线程问题，确保在主线程安全记录日志。

## v0.5.3

*Added*

- Sign in with Apple 后端增强：实现 Apple ID token 验证、nonce 支持以及更安全的 JTI 存储，改进 Apple 登录流程。

*Changed*

- 后端重构与类型改进：更新用户模型与安全依赖以改善类型处理与安全性。

*Docs*

- 新增 Sign in with Apple 开发指南并更新 README 与相关文档。

## v0.5.2

*Added*

- 日志与调试：新增日志窗口及导出/分享功能，改进日志筛选与级别选项，增强调试体验。

*Changed*

- 界面微调：若干设置视图标签与图标优化，提升可读性与一致性。

## v0.5.1

*Added*

- 后端与认证：初始化 FastAPI 后端骨架，添加用户认证與 Apple OAuth 支持（后端初始实现）。

*Changed*

- 账户与权限：改善 `AccountViewModel` 的 token 获取逻辑并为项目添加 Apple Sign In 权限配置（entitlements）。

*Docs*

- 更新 AppleBooks/GoodLinks 的本地化字符串与相关文档、Changelog 条目。

## v0.4.15

*Changed*

- 设置重构：将设置拆分为按源（AppleBooks/GoodLinks）管理，移动数据授权按钮到对应源设置，移除全局 autoSync，采用每源开关与更清晰的导航与图标。

*Fixed*

- Notion 集成修复：修复 Notion 相关 ViewModel 使用通用 `databaseIdForSource` 的问题，改进 per-source 配置使用流程。

## v0.4.14

*Changed*

- Notion 配置增强：为 AppleBooks 与 GoodLinks 提供可选的数据库 ID 配置，重构 `NotionConfigStore` 与 `NotionService` 以改善配置管理。
- GoodLinks 改进：重构 GoodLinks 列表的排序与筛选逻辑，并将工具栏移至主列表以统一体验；若干视图与枚举重命名与清理。

## v0.4.13

*Added*

- Notion 功能扩展（实验性）：引入页面级数据库映射与子数据库查找功能、feature flag 以控制子块/子库查找行为；增加 Notion API 版本升级与限流重试支持。
- 并发同步：`AutoSyncService` 支持并发同步（最高 10 本书），提高同步吞吐量与稳定性。

## v0.4.12.1

*Fixed*

- 修复 MainList 背景处理与默认背景设置，完善 GoodLinks 的排序与筛选实现。

*Changed*

- ViewModel 与性能优化：抽象并注入时间戳存储（`SyncTimestampStore`）、移除未使用导入、清理多个 ViewModel；使用 Combine 优化 IAP 状态监听与移除冗余的对象变更通知。

## v0.4.12

*Added*

- AppleBooks 功能：为高亮和书籍实现排序与筛选功能，并将相关菜单结构简化以提升可用性。

*Changed*

- 状态管理重构：将排序/筛选状态从 `@AppStorage` 替换为通过 `UserDefaults` 注入以简化状态依赖与测试。
- 复用性改进：提取共享 UI 组件以减少重复并对若干视图做重构和项目文件更新。

## v0.4.11.2

*Changed*

- Notion 上传改进：将单条截断逻辑替换为按 ≤1500 字分块上传，Highlight/Note/metadata 结构改为父块 + 子块、多个兄弟 bullet 与 metadata 子块，避免 perbookdb 模式下单条笔记因字数过大而阻塞同步。

## v0.3.9

*Added*

- 新增赞助项：如果你觉得项目不错，可以通过赞助支持我们。

## v0.3.7

*Added*

- 新增“一键同步当前书籍”快捷键，并提供详细的用户指南以帮助快速上手。

## v0.3.6

*Changed*

- 视觉与界面：背景更新、设置窗口升级、按钮样式统一等视觉改进，改善整体一致性与可读性。

*Added*

- 关于我们页面、书籍刷新功能與侧边栏切换支持（含快捷键）。

*Fixed*

- 若干导航与菜单相关修复：去除多余的返回按钮与隐藏不常用功能以提升用户体验。

---

感谢所有测试用户的反馈，让 SyncNos 变得越来越好！

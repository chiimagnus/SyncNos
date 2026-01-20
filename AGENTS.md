# 仓库指南

SyncNos 是一个 SwiftUI macOS 应用：把 Apple Books / GoodLinks / WeRead / Dedao / Chats OCR 的高亮与笔记同步到 Notion（见 `README.md` 获取产品与使用说明）。

## 项目结构与模块组织

- `SyncNos/`：主工程源码（按 MVVM 分层：`Views/`、`ViewModels/`、`Models/`、`Services/`）。
- `SyncNos/Services/DataSources-From/`：各数据源读取与缓存（Apple Books/GoodLinks/WeRead/Dedao/Chats/OCR）。
- `SyncNos/Services/DataSources-To/Notion/`：Notion 同步引擎与 API（`NotionSyncEngine` + `NotionSyncSourceProtocol` 适配器）。
- 详细架构/流程文档：`.codex/docs/`；SwiftUI/MVVM 细则：`SyncNos/AGENTS.md`。

## 快速入口

- App 入口：`SyncNos/SyncNosApp.swift`、`SyncNos/AppDelegate.swift`；权限/能力：`SyncNos/Info.plist`、`SyncNos/SyncNos.entitlements`。
- 依赖注入：`SyncNos/Services/Core/DIContainer.swift`（新增服务优先先加协议，再注入实现）。
- 同步主路径：`SyncNos/Services/DataSources-To/Notion/SyncEngine/`（引擎）与 `.../Adapters/`（各数据源适配器）。

## 构建、测试和开发命令

```bash
open SyncNos.xcodeproj
xcodebuild -scheme SyncNos -configuration Debug build
xcodebuild -scheme SyncNos clean
xcodebuild -scheme SyncNos test
swiftformat --dryrun SyncNos/
```

## 代码风格与约定

- **MVVM 严格分层**：Views 只做 UI；ViewModels 管理状态与业务；Models 只放数据结构；服务通过 `DIContainer.shared` 注入，避免新增全局单例。
- **接入新数据源**：在 `SyncNos/Services/DataSources-From/` 增加读取服务；在 `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/` 新增适配器实现 `NotionSyncSourceProtocol`；ViewModel 调用 `NotionSyncEngine.sync(...)`（不改引擎核心）。
- **国际化优先**：新增 UI 文案需同步补齐本地化资源，避免硬编码字符串。

## 同步与数据安全要点

- **同步模式**：Notion 支持单库（SingleDB）与每本书独立库（PerBook）；新增功能需同时考虑两种模式下的数据结构与迁移成本。
- **只读访问**：Apple Books 等外部 SQLite 数据库必须只读打开；如需长期访问，使用 macOS 安全范围书签，避免写入破坏源数据。
- **速率限制/并发**：Notion 写入受限（见 `NotionSyncConfig`/限流器相关实现）；不要在 ViewModel 里“裸并发”刷写请求。
- **凭证与隐私**：账号令牌与敏感信息走 Keychain/加密存储；避免把任何真实 token 写进日志、示例或测试数据。

## DetailView 生命周期与内存（必读）

- 绑定生命周期加载：优先 `.task(id:)`；如需 `Task {}`，由 ViewModel 持有并在切换/退出时取消。
- 防串台：长任务/分页用 token 或 selectionId 校验，丢弃过期结果。
- 强制释放：关闭会话（如 SQLite 只读 session），并对大数组用 `removeAll(keepingCapacity: false)`。

## 验证与调试

- **同步相关改动**：至少手动覆盖「增量同步 / 全量同步」各一次，并验证不会重复写入、不会把旧 selection 的结果回写到新页面。
- **UI/本地化改动**：检查暗黑模式与中/英两种语言（或更多）下的布局、截断与空状态；菜单栏入口与设置页需回归。
- **日志与格式化**：日志避免输出敏感信息；需要时再跑 `swiftformat`，避免一次性重排造成巨大 diff。

## 提交与 Pull Request

- 变更保持小而聚焦；UI 变更附截图；涉及用户可见行为时更新 `CHANGELOG.md`。
- 避免“顺手重构+改功能”混在一起；除非必要不要做全仓库格式化/重命名；公共协议/模型变更要同步更新相关文档（`.codex/docs/`）。

## Quick Notes (EN)

Keep strict MVVM boundaries (Views = UI only, ViewModels = state + business logic, Models = data). Use dependency injection via `DIContainer.shared` instead of adding new singletons. New sync sources should plug in through `NotionSyncSourceProtocol` adapters (don’t modify `NotionSyncEngine` core unless unavoidable). For detail screens, bind loading to `.task(id:)`, cancel on selection change, and drop stale async results to prevent “wrong-detail updates”. Never log real tokens/cookies; store sensitive data in Keychain/encrypted storage. Validate with `xcodebuild` and keep PRs small and focused.

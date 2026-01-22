# 添加新同步目标完整指南 (Add New Sync Target Checklist)

本文档详细描述了如何在 SyncNos 中添加新的同步目标（例如：Obsidian、Lark/飞书、Logseq 等）。

> **提示**: 本文档以 `Yyy` 作为新同步目标的占位符。实际开发时请替换为真实名称（如 `Obsidian`）。
> 
> **参考代码**: 参考项目中已有的 Notion 实现：`Services/DataSources-To/Notion/`

---

## 目录

1. [概述](#概述)
2. [架构设计](#架构设计)
3. [前置准备](#前置准备)
4. [第一阶段：基础架构重构](#第一阶段基础架构重构)
5. [第二阶段：创建新同步目标](#第二阶段创建新同步目标)
6. [第三阶段：配置与 UI](#第三阶段配置与-ui)
7. [第四阶段：集成与测试](#第四阶段集成与测试)
8. [完整文件清单](#完整文件清单)
9. [常见问题](#常见问题-faq)

---

## 实施顺序与任务依赖

### 阶段 1 任务依赖图

```
1.1 创建目录
     ↓
1.2 SyncTargetProtocol ←──┐
     ↓                    │
1.3 移动 SyncSourceProtocol ──→ 需要更新所有 Adapter 的 import
     ↓
1.4 移动 SyncTimestampStore
     ↓
1.5 SyncTargetRegistry ←── 依赖 1.2 SyncTargetProtocol
     ↓
1.6 NotionSyncTarget ←── 依赖 1.2, 1.5
     ↓
1.7 更新 DIContainer ←── 依赖 1.5, 1.6
     ↓
1.8 更新所有 Adapter import ←── 依赖 1.3
```

### 阶段 2-4 任务依赖图（每个新目标）

```
2.1 创建目录
     ↓
2.2 添加枚举值 ←── 依赖阶段 1 完成
     ↓
2.3 YyyConfigStore
     ↓
2.4 服务层（可选）
     ↓
2.5 YyySyncTarget ←── 依赖 2.3, 2.4
     ↓
3.1-3.4 UI 层 ←── 依赖 2.3, 2.5
     ↓
4.1 DIContainer ←── 依赖 2.3, 2.5
     ↓
4.2-4.3 ViewModel/AutoSync 更新
     ↓
4.4 国际化
```

---

## 概述

### 当前架构问题

当前实现与 Notion 强耦合：

```
ViewModel → NotionSyncEngine → NotionService
              ↓
        NotionSyncSourceProtocol (Adapter)
```

**问题**：
- `NotionSyncEngine` 直接依赖 Notion 服务
- Adapter 协议名称包含 "Notion"
- ViewModel 直接引用 `NotionSyncEngine`

### 目标架构

抽象同步目标协议，支持多目标同步：

```
ViewModel → SyncTargetRegistry → [SyncTargetProtocol]
                                      │
                    ┌─────────────────┼─────────────────┐
                    ↓                 ↓                 ↓
              NotionTarget      ObsidianTarget     LarkTarget
```

---

## 架构设计

### 协议层次

```
┌─────────────────────────────────────────────────────────────────┐
│                     SyncTargetProtocol                           │
│            (通用同步目标协议 - 所有目标必须实现)                   │
├─────────────────────────────────────────────────────────────────┤
│  var targetKey: String          // "notion", "obsidian"          │
│  var displayName: String        // "Notion", "Obsidian"          │
│  var isConfigured: Bool         // 是否已配置                     │
│  var configurationView: AnyView // 配置界面                       │
│  func sync(source:progress:) async throws                        │
│  func syncSmart(source:progress:) async throws                   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
          ┌───────────────────┼───────────────────┐
          │                   │                   │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  NotionTarget   │ │ ObsidianTarget  │ │   LarkTarget    │
│  (现有逻辑重构)  │ │  (Markdown)     │ │   (飞书 API)    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 数据流

```
数据源 (AppleBooks/WeRead/GoodLinks)
         │
         ▼
    SyncSourceProtocol (Adapter)
         │
         ▼
    UnifiedHighlight / UnifiedSyncItem
         │
         ▼
    SyncTargetRegistry
         │
         ├──→ NotionTarget (如果启用)
         ├──→ ObsidianTarget (如果启用)
         └──→ LarkTarget (如果启用)
```

### 多目标同步支持

用户可以同时启用多个同步目标，每个目标独立开关：

```swift
// UserDefaults Keys
"syncTarget.notion.enabled"    // Notion 启用开关
"syncTarget.obsidian.enabled"  // Obsidian 启用开关
"syncTarget.lark.enabled"      // Lark 启用开关
```

---

## 前置准备

### Checklist

- [ ] 确定同步目标类型（云端 API / 本地文件系统）
- [ ] 研究目标平台的 API 或文件格式
- [ ] 确定认证方式（OAuth / API Key / 本地路径）
- [ ] 确定数据结构映射（高亮如何在目标平台表示）

### 同步目标类型对比

| 类型 | 示例 | 特点 |
|------|------|------|
| 云端 API | Notion, Lark | 需要认证，网络请求 |
| 本地文件 | Obsidian, Logseq | 需要文件路径，直接写入 |
| 混合 | iCloud 同步的 Obsidian | 本地写入 + 云同步 |

---

## 第一阶段：基础架构重构

> **注意**: 此阶段只需执行一次，后续添加新目标无需重复。

### 1.1 创建通用同步引擎目录

```bash
mkdir -p SyncNos/Services/SyncEngine
```

### 1.2 创建 SyncTargetProtocol

**文件**: `SyncNos/Services/SyncEngine/SyncTargetProtocol.swift`

定义同步目标协议，包含：
- `SyncTargetType` 枚举：`notion`, `obsidian`, `lark` 等
- `SyncTargetProtocol` 协议：
  - `targetType: SyncTargetType` - 目标类型
  - `targetKey: String` - 目标标识符
  - `displayName: String` - 显示名称
  - `isConfigured: Bool` - 是否已配置
  - `configurationView() -> AnyView` - 配置界面
  - `syncSmart(source:progress:)` - 智能同步
  - `sync(source:incremental:progress:)` - 指定模式同步

> **参考**: 现有 `NotionSyncSourceProtocol.swift` 的协议设计模式

### 1.3 移动并重命名 SyncSourceProtocol

**从**: `Services/DataSources-To/Notion/SyncEngine/NotionSyncSourceProtocol.swift`
**到**: `Services/SyncEngine/SyncSourceProtocol.swift`

重命名：
- `NotionSyncSourceProtocol` → `SyncSourceProtocol`
- `NotionSyncStrategy` → `SyncStrategy`
- `NotionPerBookSyncSourceProtocol` → `PerBookSyncSourceProtocol`

> **参考**: 当前 `NotionSyncSourceProtocol.swift` 包含的属性和方法：
> - `sourceKey`, `databaseTitle`, `highlightSource`, `syncItem`
> - `additionalPropertyDefinitions`, `fetchHighlights()`, `additionalPageProperties()`
> - `supportedStrategies`, `currentStrategy`

### 1.4 移动 SyncTimestampStore

**从**: `Services/DataSources-To/Notion/SyncEngine/SyncTimestampStore.swift`
**到**: `Services/SyncEngine/SyncTimestampStore.swift`

> **参考**: 当前 `SyncTimestampStore.swift` 实现 `SyncTimestampStoreProtocol`

### 1.5 创建 SyncTargetRegistry

**文件**: `SyncNos/Services/SyncEngine/SyncTargetRegistry.swift`

同步目标注册中心，管理所有可用的同步目标：

| 方法/属性 | 说明 |
|----------|------|
| `register(_:)` | 注册同步目标 |
| `target(for:)` | 获取指定类型的目标 |
| `allTargets` | 所有已注册的目标 |
| `enabledTargets` | 用户启用的目标 |
| `activeTargets` | 已配置且启用的目标 |
| `isEnabled(_:)` | 检查目标是否启用 |
| `setEnabled(_:enabled:)` | 设置目标启用状态 |

> **参考**: `DIContainer.swift` 中的服务管理模式

### 1.6 重构 NotionSyncEngine

将 `NotionSyncEngine` 包装为实现 `SyncTargetProtocol` 的 `NotionSyncTarget`：

**文件**: `SyncNos/Services/DataSources-To/Notion/NotionSyncTarget.swift`

`NotionSyncTarget` 作为适配器，包装现有的 `NotionSyncEngine`：
- 实现 `SyncTargetProtocol`
- 委托同步逻辑给 `NotionSyncEngine`
- 返回 `NotionIntegrationView` 作为配置界面

> **参考**: 
> - 现有 `NotionSyncEngine.swift` 的 `syncSmart()` 和 `sync()` 方法
> - `NotionConfigStore.swift` 的 `isConfigured` 属性
> - `NotionIntegrationView.swift` 作为配置界面

### 1.7 更新 DIContainer

**文件**: `SyncNos/Services/Core/DIContainer.swift`

添加 `SyncTargetRegistry` 服务：

1. 添加私有变量：`private var _syncTargetRegistry: SyncTargetRegistry?`
2. 添加计算属性：`var syncTargetRegistry: SyncTargetRegistry { ... }`
3. 在计算属性中注册 `NotionSyncTarget()`

> **参考**: `DIContainer.swift` 中 `notionSyncEngine` 的注册模式（第 32 行）

### 阶段 1 Checklist

- [ ] 创建 `Services/SyncEngine/` 目录
- [ ] 创建 `SyncTargetProtocol.swift`
- [ ] 移动并重命名 `SyncSourceProtocol.swift`
- [ ] 移动 `SyncTimestampStore.swift`
- [ ] 创建 `SyncTargetRegistry.swift`
- [ ] 创建 `NotionSyncTarget.swift`
- [ ] 更新 `DIContainer.swift`
- [ ] 更新所有 Adapter 文件的 import

---

## 第二阶段：创建新同步目标

### 2.1 创建目标目录

```bash
mkdir -p SyncNos/Services/DataSources-To/Yyy
```

### 2.2 添加目标枚举值

**文件**: `Services/SyncEngine/SyncTargetProtocol.swift`

```swift
enum SyncTargetType: String, CaseIterable, Codable {
    case notion
    case obsidian
    case lark
    case yyy        // ← 添加新目标
    
    var displayName: String {
        switch self {
        // ...
        case .yyy: return "Yyy"
        }
    }
}
```

### 2.3 创建配置存储

**文件**: `SyncNos/Services/DataSources-To/Yyy/YyyConfigStore.swift`

```swift
import Foundation

protocol YyyConfigStoreProtocol: AnyObject {
    var isConfigured: Bool { get }
    // 根据目标类型添加配置属性
    // 云端 API: apiKey, accessToken 等
    // 本地文件: vaultPath, outputDirectory 等
}

final class YyyConfigStore: YyyConfigStoreProtocol {
    // 实现配置存储逻辑
}
```

> **参考**: 
> - 云端 API: `Notion/Configuration/NotionConfigStore.swift`
> - 本地文件: 直接使用 `UserDefaults` 存储路径

### 2.4 创建服务层（如需要）

**云端 API 目标**:

```bash
# 创建服务文件
touch SyncNos/Services/DataSources-To/Yyy/YyyService.swift
touch SyncNos/Services/DataSources-To/Yyy/YyyRequestHelper.swift
```

**本地文件目标**:

```bash
# 创建文件写入服务
touch SyncNos/Services/DataSources-To/Yyy/YyyFileWriter.swift
touch SyncNos/Services/DataSources-To/Yyy/YyyMarkdownFormatter.swift
```

### 2.5 创建同步目标实现

**文件**: `SyncNos/Services/DataSources-To/Yyy/YyySyncTarget.swift`

实现 `SyncTargetProtocol`：

| 属性/方法 | 说明 |
|----------|------|
| `targetType` | 返回 `.yyy` |
| `isConfigured` | 委托给 `configStore.isConfigured` |
| `configurationView()` | 返回 `YyyIntegrationView()` |
| `syncSmart(source:progress:)` | 基于时间戳自动选择全量/增量 |
| `sync(source:incremental:progress:)` | 执行同步逻辑 |

同步流程：
1. 校验配置 `isConfigured`
2. 调用 `source.fetchHighlights()` 获取数据
3. 执行目标特定的同步逻辑（API 调用或文件写入）
4. 更新时间戳 `timestampStore.setLastSyncTime()`

> **参考**: 
> - `NotionSyncEngine.swift` 的 `sync()` 方法结构（第 48-67 行）
> - `NotionSyncEngine.swift` 的 `syncSingleDatabase()` 方法（第 72-158 行）

**错误定义**:

创建 `YyyError` 枚举：`notConfigured`, `syncFailed(String)` 等

> **参考**: `NotionSyncEngine.swift` 中的 `NSError` 创建模式

### 阶段 2 Checklist

- [ ] 创建 `Services/DataSources-To/Yyy/` 目录
- [ ] 在 `SyncTargetType` 枚举中添加新目标
- [ ] 创建 `YyyConfigStore.swift`
- [ ] 创建服务层文件（如需要）
- [ ] 创建 `YyySyncTarget.swift`
- [ ] 在 `Protocols.swift` 中添加配置协议

---

## 第三阶段：配置与 UI

### 3.1 创建配置视图

**文件**: `SyncNos/Views/Settting/SyncTo/YyyIntegrationView.swift`

配置视图需要包含：
- 配置输入区（API Key / OAuth / 文件夹选择）
- 连接状态显示
- 测试连接按钮
- 断开连接按钮

> **参考**: `Views/Settting/Sync/NotionIntegrationView.swift`

### 3.2 创建配置 ViewModel

**文件**: `SyncNos/ViewModels/SyncTo/YyyIntegrationViewModel.swift`

### 3.3 更新设置视图

**文件**: `SyncNos/Views/Settting/General/SettingsView.swift`

添加新同步目标的设置入口：
1. 在 "Sync Targets" Section 中添加 `NavigationLink`
2. 添加 `navigationDestination` 处理

> **参考**: 搜索 `NotionIntegrationView` 查看添加位置

### 3.4 添加目标启用开关

在每个数据源的设置视图中添加同步目标选择。

> **参考**: 
> - `AppleBooksSettingsView.swift` 中的同步策略选择
> - `WeReadSettingsView.swift` 中的开关设置

### 阶段 3 Checklist

- [ ] 创建 `YyyIntegrationView.swift`
- [ ] 创建 `YyyIntegrationViewModel.swift`
- [ ] 在 `SettingsView.swift` 中添加入口
- [ ] 在数据源设置中添加目标启用开关

---

## 第四阶段：集成与测试

### 4.1 更新 DIContainer

**文件**: `SyncNos/Services/Core/DIContainer.swift`

添加：
1. 私有变量：`private var _yyyConfigStore: YyyConfigStoreProtocol?`
2. 计算属性：`var yyyConfigStore: YyyConfigStoreProtocol { ... }`
3. 在 `syncTargetRegistry` 中注册 `YyySyncTarget()`

> **参考**: `DIContainer.swift` 中 `notionConfigStore` 的注册模式（第 52-57 行）

### 4.2 更新 ViewModel 同步逻辑

ViewModel 需要遍历所有启用的目标：

1. 获取 `DIContainer.shared.syncTargetRegistry`
2. 创建数据源适配器
3. 遍历 `registry.activeTargets`
4. 对每个目标调用 `target.syncSmart(source:progress:)`
5. 处理错误（单目标失败不影响其他目标）

> **参考**: 
> - `WeReadViewModel.swift` 的 `syncBook(_:)` 方法
> - `AppleBooksViewModel.swift` 的 `syncBook(_:)` 方法

### 4.3 更新自动同步

更新 `AutoSyncProvider` 以支持多目标：

1. 获取 `DIContainer.shared.syncTargetRegistry`
2. 在 `syncAllBooks()` 中遍历 `registry.activeTargets`
3. 对每个目标执行同步

> **参考**: 
> - `WeReadAutoSyncProvider.swift` 的 `syncAllBooks()` 方法
> - `AppleBooksAutoSyncProvider.swift` 的同步逻辑

### 4.4 国际化

在 16 种语言的 `Localizable.strings` 中添加：
- 目标名称：`"Yyy" = "Yyy";`
- 设置相关：`"Yyy Integration"`, `"Configure Yyy"`
- 状态信息：`"Yyy is not configured"`, `"Sync to Yyy failed"`

> **参考**: `Resource/Localization/` 目录下的本地化文件

### 阶段 4 Checklist

- [ ] 在 `DIContainer.swift` 中添加服务注册
- [ ] 在 `SyncTargetRegistry` 中注册新目标
- [ ] 更新 ViewModel 同步逻辑
- [ ] 更新 AutoSyncProvider
- [ ] 添加本地化字符串
- [ ] 测试同步功能

---

## 完整文件清单

### 阶段 1：基础架构（一次性）

| 路径 | 说明 |
|------|------|
| `Services/SyncEngine/SyncTargetProtocol.swift` | 同步目标协议 |
| `Services/SyncEngine/SyncSourceProtocol.swift` | 数据源协议（重命名） |
| `Services/SyncEngine/SyncTimestampStore.swift` | 时间戳存储（移动） |
| `Services/SyncEngine/SyncTargetRegistry.swift` | 目标注册中心 |
| `Services/DataSources-To/Notion/NotionSyncTarget.swift` | Notion 目标包装 |

### 阶段 2-4：每个新目标

| 路径 | 说明 |
|------|------|
| `Services/DataSources-To/Yyy/YyyConfigStore.swift` | 配置存储 |
| `Services/DataSources-To/Yyy/YyySyncTarget.swift` | 同步目标实现 |
| `Services/DataSources-To/Yyy/YyyService.swift` | 服务层（可选） |
| `ViewModels/SyncTo/YyyIntegrationViewModel.swift` | 配置 ViewModel |
| `Views/Settting/SyncTo/YyyIntegrationView.swift` | 配置视图 |

### 修改文件

| 路径 | 修改内容 |
|------|----------|
| `Services/SyncEngine/SyncTargetProtocol.swift` | 添加 `SyncTargetType.yyy` |
| `Services/Core/DIContainer.swift` | 添加服务注册 |
| `Services/Core/Protocols.swift` | 添加配置协议 |
| `Views/Settting/General/SettingsView.swift` | 添加设置入口 |
| `Localizable.strings` | 添加本地化字符串 |

---

## 关键文件参考

### 阶段 1 需要参考的现有文件

| 任务 | 参考文件 | 说明 |
|------|----------|------|
| 1.2 SyncTargetProtocol | `NotionSyncSourceProtocol.swift` | 协议设计模式 |
| 1.3 重命名协议 | `NotionSyncSourceProtocol.swift` | 完整协议定义 |
| 1.4 时间戳存储 | `SyncTimestampStore.swift` | 实现模式 |
| 1.5 Registry | `DIContainer.swift` | 服务管理模式 |
| 1.6 NotionSyncTarget | `NotionSyncEngine.swift` | 同步方法签名 |
| 1.7 DIContainer | `DIContainer.swift:32-33` | 服务注册模式 |

### 阶段 2-4 需要参考的现有文件

| 任务 | 参考文件 | 说明 |
|------|----------|------|
| 2.3 ConfigStore | `NotionConfigStore.swift` | 配置存储模式 |
| 2.4 服务层 | `NotionService.swift`, `NotionRequestHelper.swift` | API 交互模式 |
| 2.5 SyncTarget | `NotionSyncEngine.swift:48-158` | 同步流程实现 |
| 3.1 配置视图 | `NotionIntegrationView.swift` | UI 布局和交互 |
| 3.2 配置 ViewModel | `NotionIntegrationViewModel.swift` | 状态管理 |
| 4.2 ViewModel 更新 | `WeReadViewModel.swift:syncBook()` | 同步调用模式 |
| 4.3 AutoSync 更新 | `WeReadAutoSyncProvider.swift` | 自动同步实现 |

### Adapter 文件参考

| 数据源 | Adapter 文件 | 说明 |
|--------|-------------|------|
| Apple Books | `AppleBooksNotionAdapter.swift` | 本地数据库示例 |
| GoodLinks | `GoodLinksNotionAdapter.swift` | 带额外属性示例 |
| WeRead | `WeReadNotionAdapter.swift` | Web API 示例 |

---

## 快速参考

### UserDefaults Keys

| Key | 用途 |
|-----|------|
| `syncTarget.yyy.enabled` | 目标启用开关 |
| `yyy.config.*` | 目标配置项 |

### 同步目标类型对比

| 目标 | 类型 | 认证方式 | 数据存储 |
|------|------|----------|----------|
| Notion | 云端 API | OAuth / API Key | 数据库+页面 |
| Obsidian | 本地文件 | 无（文件夹选择） | Markdown 文件 |
| Lark | 云端 API | OAuth | 云文档 |
| Logseq | 本地文件 | 无（文件夹选择） | Markdown 文件 |

---

## 实施注意事项

### 阶段 1 关键步骤详解

#### 1.3 协议重命名的影响范围

移动并重命名 `NotionSyncSourceProtocol` 后，需要更新以下文件的 import 和类型引用：

```
Services/DataSources-To/Notion/SyncEngine/Adapters/
├── AppleBooksNotionAdapter.swift  ← 更新 protocol 名称
├── GoodLinksNotionAdapter.swift   ← 更新 protocol 名称
├── WeReadNotionAdapter.swift      ← 更新 protocol 名称
└── GoodLinksSyncService.swift     ← 更新 protocol 名称

Services/DataSources-To/Notion/SyncEngine/
└── NotionSyncEngine.swift         ← 更新 protocol 名称

ViewModels/
├── AppleBooks/AppleBooksViewModel.swift      ← 检查类型引用
├── AppleBooks/AppleBooksDetailViewModel.swift
├── WeRead/WeReadViewModel.swift
└── WeRead/WeReadDetailViewModel.swift
```

#### 1.6 NotionSyncTarget 的关键实现

`NotionSyncTarget` 需要将 `SyncSourceProtocol` 转换为 `NotionSyncSourceProtocol`：

```swift
// 关键：类型转换
func syncSmart(source: SyncSourceProtocol, ...) async throws {
    // 如果 source 已经是 NotionSyncSourceProtocol，直接使用
    // 否则可能需要适配器包装
    guard let notionSource = source as? NotionSyncSourceProtocol else {
        throw SyncTargetError.incompatibleSource
    }
    try await syncEngine.syncSmart(source: notionSource, progress: progress)
}
```

### 阶段 2 关键步骤详解

#### 本地文件目标（如 Obsidian）的特殊考虑

1. **文件路径配置**：使用 `NSOpenPanel` 选择 Vault 目录
2. **书签持久化**：参考 `BookmarkStore.swift` 的安全范围书签
3. **文件写入**：使用 `FileManager` 写入 Markdown
4. **冲突处理**：提供覆盖/追加/跳过选项

#### 云端 API 目标（如 Lark）的特殊考虑

1. **OAuth 认证**：参考 `NotionOAuthService.swift`
2. **速率限制**：参考 `NotionRateLimiter.swift`
3. **错误重试**：参考 `NotionRequestHelper.swift`
4. **Token 刷新**：参考 `WeReadCookieRefreshService.swift`

---

## 常见问题 (FAQ)

### Q1: 阶段 1 需要每次添加新目标都执行吗？

不需要。阶段 1 是基础架构重构，只需执行一次。之后添加新目标只需执行阶段 2-4。

### Q2: 如何处理不同目标的数据格式差异？

每个 `SyncTarget` 实现自己的数据转换逻辑：
- Notion: 转换为 Notion API 格式
- Obsidian: 转换为 Markdown 格式
- Lark: 转换为飞书 API 格式

### Q3: 时间戳存储如何区分不同目标？

使用复合 key：`"{targetKey}:{itemId}"`

```swift
let key = "notion:book123"  // Notion 目标的 book123
let key = "obsidian:book123"  // Obsidian 目标的 book123
```

### Q4: 如何处理同步失败？

- 单目标失败不影响其他目标
- 记录错误日志
- 在 UI 中显示失败状态
- 支持重试

### Q5: 本地文件目标如何处理冲突？

- 默认覆盖模式
- 可选：追加模式、合并模式
- 建议在配置中提供选项

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 1.0 | 2025-11-25 | 初始版本 |

---

*文档版本: 1.0*
*最后更新: 2025-11-25*


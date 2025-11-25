# 添加新数据源完整指南 (Add New DataSource Checklist)

本文档详细描述了如何在 SyncNos 中添加新的数据源（例如：得到、Logseq、Readwise 等）。

> **提示**: 本文档以 `Xxx` 作为新数据源的占位符。实际开发时请替换为真实名称（如 `Dedao`）。
> 
> **参考代码**: 建议参考项目中已有的数据源实现：
> - **Web API 数据源**: 参考 `WeRead` 实现
> - **本地数据库数据源**: 参考 `AppleBooks` 或 `GoodLinks` 实现

---

## 目录

1. [概述](#概述)
2. [前置准备](#前置准备)
3. [第一阶段：数据模型](#第一阶段数据模型)
4. [第二阶段：数据读取服务](#第二阶段数据读取服务)
5. [第三阶段：同步适配器](#第三阶段同步适配器)
6. [第四阶段：ViewModel](#第四阶段viewmodel)
7. [第五阶段：Views](#第五阶段views)
8. [第六阶段：自动同步](#第六阶段自动同步)
9. [第七阶段：配置与注册](#第七阶段配置与注册)
11. [第八阶段：测试与验证](#第八阶段测试与验证)
12. [完整文件清单](#完整文件清单)
13. [常见问题](#常见问题-faq)

---

## 概述

### 架构模式

```
┌─────────────────────────────────────────────────────────────────┐
│                           Views                                  │
│         (XxxListView, XxxDetailView, XxxSettingsView)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ViewModels                                │
│              (XxxViewModel, XxxSettingsViewModel)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NotionSyncEngine                              │
│       (统一同步引擎，处理所有数据源到 Notion 的同步)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                NotionSyncSourceProtocol                          │
│                    (数据源适配器)                                 │
│         XxxNotionAdapter - 将数据源转换为 UnifiedHighlight       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DataSource Service                            │
│         (XxxAPIService / XxxDatabaseService - 读取原始数据)      │
└─────────────────────────────────────────────────────────────────┘
```

### 命名约定

| 类型 | 命名模式 | 参考文件 |
|------|----------|----------|
| 数据模型 | `XxxModels.swift` | `WeReadModels.swift` |
| 缓存模型 | `XxxCacheModels.swift` | `WeReadCacheModels.swift` |
| API 服务 | `XxxAPIService.swift` | `WeReadAPIService.swift` |
| 认证服务 | `XxxAuthService.swift` | `WeReadAuthService.swift` |
| 适配器 | `XxxNotionAdapter.swift` | `WeReadNotionAdapter.swift` |
| ViewModel | `XxxViewModel.swift` | `WeReadViewModel.swift` |
| DetailViewModel | `XxxDetailViewModel.swift` | `WeReadDetailViewModel.swift` |
| ListView | `XxxListView.swift` | `WeReadListView.swift` |
| DetailView | `XxxDetailView.swift` | `WeReadDetailView.swift` |
| SettingsView | `XxxSettingsView.swift` | `WeReadSettingsView.swift` |
| AutoSyncProvider | `XxxAutoSyncProvider.swift` | `WeReadAutoSyncProvider.swift` |

---

## 前置准备

### Checklist

- [ ] 确定数据源类型（本地数据库 / Web API / 文件系统）
- [ ] 研究数据源的数据结构（书籍/文章、高亮、笔记）
- [ ] 确定认证方式（Cookie / OAuth / API Key / 无需认证）
- [ ] 确定同步策略（仅支持 SingleDB / 支持 PerBook）

---

## 第一阶段：数据模型

### 1.1 添加数据源枚举值

需要在以下三个文件中添加新数据源的枚举值：

| 文件 | 枚举 | 说明 |
|------|------|------|
| `Models/SyncQueueModels.swift` | `SyncSource` | 同步队列标识 |
| `Models/Models.swift` | `ContentSource` | 内容来源（含显示名称） |
| `Models/HighlightColorScheme.swift` | `HighlightSource` | 高亮颜色映射 |

> **参考**: 搜索现有的 `weRead` case 查看添加位置

### 1.2 创建数据模型文件

**文件**: `SyncNos/Models/XxxModels.swift`

需要定义：
- 书籍/文章列表项模型（如 `XxxBookListItem`）
- API 响应模型（如果是 Web API）
- 高亮/书签数据模型

> **参考**: `WeReadModels.swift` 或 `GoodLinksModels.swift`

### 1.3 添加 UnifiedHighlight 转换

**文件**: `SyncNos/Models/UnifiedHighlight.swift`

添加两个转换初始化器：
- `init(from bookmark: XxxBookmark)` - 高亮转换
- `init(from item: XxxBookListItem)` - 在 `UnifiedSyncItem` 中添加

> **参考**: 搜索 `init(from book: WeReadBookListItem)` 查看示例

### 1.4 创建缓存模型（可选）

**文件**: `SyncNos/Models/XxxCacheModels.swift`

如需本地缓存，定义 SwiftData `@Model` 类。

> **参考**: `WeReadCacheModels.swift`

### Checklist

- [ ] 在 `SyncSource` 枚举中添加新数据源
- [ ] 在 `ContentSource` 枚举中添加新数据源和显示名称
- [ ] 在 `HighlightSource` 枚举中添加新数据源
- [ ] 在 `HighlightColorScheme.allDefinitions` 中添加颜色映射
- [ ] 创建 `XxxModels.swift`
- [ ] 在 `UnifiedHighlight.swift` 中添加转换初始化器
- [ ] （可选）创建 `XxxCacheModels.swift`

---

## 第二阶段：数据读取服务

### 2.1 创建服务目录

```bash
mkdir -p SyncNos/Services/DataSources-From/Xxx
```

### 2.2 在 Protocols.swift 中添加协议定义

**文件**: `SyncNos/Services/Core/Protocols.swift`

添加服务协议：
- `XxxAuthServiceProtocol`（如需认证）
- `XxxAPIServiceProtocol` 或 `XxxDatabaseServiceProtocol`
- `XxxCacheServiceProtocol`（可选）

> **参考**: 搜索 `WeReadAuthServiceProtocol` 查看协议定义格式

### 2.3 创建服务实现

根据数据源类型创建：

| 数据源类型 | 需要创建的服务 | 参考 |
|-----------|---------------|------|
| Web API | `XxxAuthService.swift`, `XxxAPIService.swift` | `WeRead/` |
| 本地数据库 | `XxxDatabaseService.swift`, `XxxConnectionService.swift` | `GoodLinks/` |
| 两者皆有 | 全部 | - |

> **参考**: `Services/DataSources-From/WeRead/` 或 `Services/DataSources-From/GoodLinks/`

### Checklist

- [ ] 创建 `Services/DataSources-From/Xxx/` 目录
- [ ] 在 `Protocols.swift` 中添加服务协议定义
- [ ] 创建 `XxxAuthService.swift`（如需认证）
- [ ] 创建 `XxxAPIService.swift` 或 `XxxDatabaseService.swift`
- [ ] （可选）创建 `XxxCacheService.swift`

---

## 第三阶段：同步适配器

### 3.1 创建 Notion 适配器

**文件**: `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/XxxNotionAdapter.swift`

实现 `NotionSyncSourceProtocol`：

| 属性/方法 | 说明 |
|----------|------|
| `sourceKey` | 数据源标识符（如 `"xxx"`） |
| `databaseTitle` | Notion 数据库标题（如 `"SyncNos-Xxx"`） |
| `highlightSource` | 对应的 `HighlightSource` 枚举值 |
| `syncItem` | 返回 `UnifiedSyncItem` |
| `fetchHighlights()` | 获取高亮数据 |
| `additionalPropertyDefinitions` | 额外的数据库属性 |
| `additionalPageProperties()` | 额外的页面属性 |

> **参考**: `WeReadNotionAdapter.swift` 或 `AppleBooksNotionAdapter.swift`

### 3.2 创建特殊 SyncService（可选）

如果 `NotionSyncEngine.syncSmart()` 无法满足需求（如需处理文章内容），创建 Facade 服务。

> **参考**: `GoodLinksSyncService.swift`（处理文章内容的特殊逻辑）

### Checklist

- [ ] 创建 `XxxNotionAdapter.swift`
- [ ] 实现 `NotionSyncSourceProtocol` 所有必需属性和方法
- [ ] （可选）实现 `NotionPerBookSyncSourceProtocol`（如需 PerBook 策略）
- [ ] （可选）创建 `XxxSyncService.swift`（如需特殊同步逻辑）

---

## 第四阶段：ViewModel

### 4.1 创建 ViewModel 目录和文件

```bash
mkdir -p SyncNos/ViewModels/Xxx
```

需要创建：

| 文件 | 说明 | 必需 |
|------|------|------|
| `XxxViewModel.swift` | 列表 ViewModel | ✅ |
| `XxxSettingsViewModel.swift` | 设置 ViewModel | ✅ |
| `XxxDetailViewModel.swift` | 详情 ViewModel | 可选 |

> **参考**: `ViewModels/WeRead/` 目录下的文件

### Checklist

- [ ] 创建 `ViewModels/Xxx/` 目录
- [ ] 创建 `XxxViewModel.swift`
- [ ] 创建 `XxxSettingsViewModel.swift`
- [ ] （可选）创建 `XxxDetailViewModel.swift`
- [ ] 实现书籍加载、同步、错误处理逻辑
- [ ] 实现 `setCacheService()` 方法（如需缓存）
- [ ] 实现 `navigateToXxxLogin()` 导航方法

---

## 第五阶段：Views

### 5.1 创建视图目录和文件

```bash
mkdir -p SyncNos/Views/Xxx
```

需要创建：

| 文件 | 说明 | 必需 |
|------|------|------|
| `XxxListView.swift` | 列表视图 | ✅ |
| `XxxDetailView.swift` | 详情视图 | 可选 |
| `XxxSettingsView.swift` | 设置视图（在 `Views/Settting/SyncFrom/`） | ✅ |
| `XxxLoginView.swift` | 登录视图（在 `Views/Settting/SyncFrom/`） | 如需 WebView 登录 |

> **参考**: `Views/WeRead/` 和 `Views/Settting/SyncFrom/WeRead*`

### 5.2 更新 MainListView

**文件**: `SyncNos/Views/Components/MainListView.swift`

添加：
1. `@AppStorage("datasource.xxx.enabled")` 开关
2. `@StateObject private var xxxVM = XxxViewModel()`
3. 在 `availableSources` 中添加条件
4. 在视图切换中添加 `case .xxx`
5. 在 `onAppear` 中注入缓存服务
6. 添加 `onChange(of: xxxSourceEnabled)` 监听

> **参考**: 搜索 `weReadSourceEnabled` 查看添加位置

### 5.3 更新 SettingsView

**文件**: `SyncNos/Views/Settting/General/SettingsView.swift`

添加：
1. `NavigationLink` 到 `XxxSettingsView`
2. `navigationDestination` 处理 `"xxxSettings"`
3. `onReceive` 监听 `NavigateToXxxSettings` 通知

> **参考**: 搜索 `weReadSettings` 查看添加位置

### Checklist

- [ ] 创建 `Views/Xxx/` 目录
- [ ] 创建 `XxxListView.swift`
- [ ] （可选）创建 `XxxDetailView.swift`
- [ ] 创建 `Views/Settting/SyncFrom/XxxSettingsView.swift`
- [ ] （可选）创建 `XxxLoginView.swift`
- [ ] 在 `MainListView.swift` 中添加数据源开关和视图
- [ ] 在 `SettingsView.swift` 中添加设置入口和导航

---

## 第六阶段：自动同步

### 6.1 创建 AutoSyncProvider

**文件**: `SyncNos/Services/SyncScheduling/XxxAutoSyncProvider.swift`

实现 `AutoSyncSourceProvider` 协议。

> **参考**: `WeReadAutoSyncProvider.swift`

### 6.2 更新 AutoSyncService

**文件**: `SyncNos/Services/SyncScheduling/AutoSyncService.swift`

1. 在 `init` 中创建并添加 `XxxAutoSyncProvider` 到 `providers` 字典
2. 在 `start()` 中添加 `XxxLoginSucceeded` 通知监听
3. 添加 `triggerXxxNow()` 方法

> **参考**: 搜索 `weRead` 查看添加位置

### 6.3 更新协议和 App 入口

1. **Protocols.swift**: 在 `AutoSyncServiceProtocol` 中添加 `triggerXxxNow()`
2. **SyncNosApp.swift**: 在 `autoSyncEnabled` 检查中添加 `autoSync.xxx`

### Checklist

- [ ] 创建 `XxxAutoSyncProvider.swift`
- [ ] 在 `AutoSyncService.swift` 中添加 provider
- [ ] 在 `AutoSyncService.swift` 中添加通知监听和触发方法
- [ ] 在 `Protocols.swift` 中添加 `triggerXxxNow()`
- [ ] 在 `SyncNosApp.swift` 中添加自动同步检查

---

## 第七阶段：配置与注册

### 7.1 更新 DIContainer

**文件**: `SyncNos/Services/Core/DIContainer.swift`

添加：
1. 私有变量：`_xxxAuthService`、`_xxxAPIService`、`_xxxCacheService`
2. 计算属性：`xxxAuthService`、`xxxAPIService`、`xxxCacheService`
3. 注册方法：`register(xxxAuthService:)` 等

> **参考**: 搜索 `weReadAuthService` 查看添加位置

### 7.2 添加到 Xcode 项目

确保所有新文件都添加到 Xcode 项目的正确 target 中。

### Checklist

- [ ] 在 `DIContainer.swift` 中添加服务注册
- [ ] 确保所有新文件添加到 Xcode 项目
- [ ] 验证依赖注入正确配置

---

## 第八阶段：测试与验证

### 功能测试清单

- [ ] 登录功能正常
- [ ] 书籍列表正确加载
- [ ] 高亮数据正确获取
- [ ] 同步到 Notion 成功
- [ ] 增量同步正确工作
- [ ] 自动同步正确触发
- [ ] 错误处理正确显示
- [ ] Session 过期正确提示并导航

### 构建验证

```bash
xcodebuild -scheme SyncNos -configuration Debug build 2>&1 | grep -E "error:|warning:"
```

---

## 完整文件清单

### 新建文件

| 路径 | 必需 |
|------|------|
| `Models/XxxModels.swift` | ✅ |
| `Models/XxxCacheModels.swift` | 可选 |
| `Services/DataSources-From/Xxx/XxxAuthService.swift` | 如需认证 |
| `Services/DataSources-From/Xxx/XxxAPIService.swift` | Web API |
| `Services/DataSources-From/Xxx/XxxDatabaseService.swift` | 本地数据库 |
| `Services/DataSources-From/Xxx/XxxCacheService.swift` | 可选 |
| `Services/DataSources-To/Notion/SyncEngine/Adapters/XxxNotionAdapter.swift` | ✅ |
| `Services/DataSources-To/Notion/SyncEngine/Adapters/XxxSyncService.swift` | 可选 |
| `ViewModels/Xxx/XxxViewModel.swift` | ✅ |
| `ViewModels/Xxx/XxxDetailViewModel.swift` | 可选 |
| `ViewModels/Xxx/XxxSettingsViewModel.swift` | ✅ |
| `Views/Xxx/XxxListView.swift` | ✅ |
| `Views/Xxx/XxxDetailView.swift` | 可选 |
| `Views/Settting/SyncFrom/XxxSettingsView.swift` | ✅ |
| `Views/Settting/SyncFrom/XxxLoginView.swift` | 如需登录 |
| `Services/SyncScheduling/XxxAutoSyncProvider.swift` | ✅ |

### 修改文件

| 路径 | 修改内容 |
|------|----------|
| `Models/SyncQueueModels.swift` | 添加 `SyncSource.xxx` |
| `Models/Models.swift` | 添加 `ContentSource.xxx` |
| `Models/HighlightColorScheme.swift` | 添加颜色映射 |
| `Models/UnifiedHighlight.swift` | 添加转换初始化器 |
| `Services/Core/Protocols.swift` | 添加协议和 `triggerXxxNow()` |
| `Services/Core/DIContainer.swift` | 添加服务注册 |
| `Services/SyncScheduling/AutoSyncService.swift` | 添加 provider |
| `Views/Components/MainListView.swift` | 添加数据源开关和视图 |
| `Views/Settting/General/SettingsView.swift` | 添加设置入口 |
| `SyncNosApp.swift` | 添加自动同步检查 |
| `Localizable.strings` (16 种语言) | 添加本地化字符串 |

---

## 快速参考

### UserDefaults Keys

| Key | 用途 |
|-----|------|
| `datasource.xxx.enabled` | 数据源启用开关 |
| `autoSync.xxx` | 自动同步启用开关 |

### Notification Names

| Name | 用途 |
|------|------|
| `XxxLoginSucceeded` | 登录成功 |
| `NavigateToXxxSettings` | 导航到设置页 |
| `XxxSettingsShowLoginSheet` | 显示登录 Sheet |

### Keychain Keys

| Key | 用途 |
|-----|------|
| `xxx.cookie` | 存储认证 Cookie |

---

## 常见问题 (FAQ)

### Q1: 什么时候需要 DetailView？

当用户需要查看单本书的详细高亮列表时。Apple Books 和 WeRead 有，GoodLinks 没有。

### Q2: 什么时候需要特殊 SyncService？

当 `NotionSyncEngine.syncSmart()` 无法满足需求时（如处理文章内容）。参考 `GoodLinksSyncService`。

### Q3: 本地数据库 vs Web API？

| 特性 | 本地数据库 | Web API |
|------|-----------|---------|
| 认证 | 通常不需要 | 需要 |
| 参考 | AppleBooks, GoodLinks | WeRead |

### Q4: 如何处理 Session 过期？

1. API 服务检测 401 错误 → 抛出 `XxxError.sessionExpired`
2. ViewModel 捕获 → 设置 `showRefreshFailedAlert = true`
3. View 显示 Alert → 提供"Go to Login"按钮
4. 通过 NotificationCenter 导航到设置页

---

*文档版本: 2.0*
*最后更新: 2025-11-25*

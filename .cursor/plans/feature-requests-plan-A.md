# Feature Requests Implementation Plan A

## 概述

本计划针对以下三个功能需求进行实现：
1. Menu Bar 显示下次 Smart Sync 时间
2. ChatListView 空状态添加截图提示
3. GoodLinks 文章内容支持 Markdown 排版

---

## P1: Menu Bar 显示下次 Smart Sync 时间 (高优先级)

### 需求分析
- 当用户开启 Smart Sync 时，在 Menu Bar 菜单中显示下次同步时间
- 需要在 `MenuBarView` 和 `MenuBarViewModel` 中添加相应逻辑

### 技术方案

#### 1.1 修改 `MenuBarViewModel.swift`
- 添加 `@Published var nextSyncTime: Date?` 属性
- 订阅 `AutoSyncService` 的定时器事件计算下次同步时间
- 当任意数据源启用 Smart Sync 时，计算 `nextSyncTime = Date() + intervalSeconds`

#### 1.2 修改 `MenuBarView.swift`
- 在 Sync Queue Status section 之前添加 Smart Sync 信息显示
- 格式：`Next sync: 10:25 AM` 或 `Next sync in 4 min`
- 只有当 Smart Sync 启用时才显示

### 预期代码变更
- `SyncNos/ViewModels/Settings/MenuBarViewModel.swift`
- `SyncNos/Views/Settings/General/MenuBarView.swift`

### 验证步骤
1. 启用 Smart Sync
2. 检查 Menu Bar 是否显示下次同步时间
3. 验证时间倒计时是否正确
4. 构建无错误

---

## P2: ChatListView 空状态添加截图提示 (中优先级)

### 需求分析
- 在 "No Chats" 空状态下添加截图建议
- 使用用户易懂的英文表达

### 技术方案

#### 2.1 修改 `ChatListView.swift`
- 在 `emptyStateView` 中添加额外的提示文本
- 建议文案：`"Tip: For best results, expand the chat area to fill your screen before taking a screenshot."`

### 预期代码变更
- `SyncNos/Views/Chats/ChatListView.swift`

### 验证步骤
1. 清空所有对话或在无对话状态下查看
2. 验证新提示文本显示正确
3. 构建无错误

---

## P3: GoodLinks 文章内容支持 Markdown 排版 (低优先级但复杂)

### 需求分析
- 当前文章内容以纯文本形式密集展示，无排版
- 需要支持 Markdown 或 HTML 渲染以保留原始格式

### 技术调研

#### 3.1 GoodLinks 数据库内容格式
根据 `GoodLinksQueryService.swift` 分析：
- `content` 表存储文章内容
- 字段：`id`, `content`, `wordCount`, `videoDuration`
- 需要确认 `content` 字段存储的是 HTML、Markdown 还是纯文本

#### 3.2 技术方案选择

**方案 A: 使用 AttributedString (推荐)**
- 如果内容是 Markdown，使用 SwiftUI 的 `AttributedString` 解析
- 优点：原生支持，性能好
- 代码：`Text(try AttributedString(markdown: content))`

**方案 B: 使用 WKWebView**
- 如果内容是 HTML，使用 WebView 渲染
- 优点：完整 HTML 支持
- 缺点：性能较差，文本选择需要额外处理

**方案 C: 自定义 Markdown 渲染**
- 使用第三方库如 `swift-markdown` 或 `Down`
- 优点：完全控制样式
- 缺点：需要添加依赖

### 预期代码变更
- `SyncNos/Views/Components/Cards/ArticleContentCardView.swift`
- 可能需要添加 Markdown 渲染辅助组件

### 验证步骤
1. 打开包含格式化内容的 GoodLinks 文章
2. 验证标题、段落、列表等格式正确显示
3. 验证文本选择功能正常
4. 构建无错误

---

## 实施顺序

1. **P1**: Menu Bar Smart Sync 时间显示 (最高优先级，用户明确需求)
2. **P2**: ChatListView 截图提示 (简单修改，快速完成)
3. **P3**: GoodLinks Markdown 支持 (需要先调研数据格式)

---

## 风险评估

| 优先级 | 功能 | 复杂度 | 风险 |
|--------|------|--------|------|
| P1 | Smart Sync 时间 | 低 | 低 - 纯 UI 添加 |
| P2 | 截图提示 | 低 | 低 - 简单文本添加 |
| P3 | Markdown 渲染 | 中-高 | 中 - 依赖数据格式，可能需要大幅修改 |

---

## 创建日期
2024-12-31

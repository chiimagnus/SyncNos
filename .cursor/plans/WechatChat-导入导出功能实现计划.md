# WechatChat 导入导出功能实现计划

## 1. 功能概述

为 WechatChat 模块实现完整的导入导出功能，支持：

### 导出功能
- **JSON 格式**：结构化数据，便于数据迁移和备份
- **Markdown 格式**：人类可读，便于分享和归档

### 导入功能
- **JSON 格式导入**：从导出的 JSON 文件恢复对话
- **Markdown 格式导入**：解析 Markdown 文件中的对话记录

### 拖拽功能
- **图片拖拽**：拖入图片触发 OCR 识别
- **文件拖拽**：拖入 JSON/MD 文件触发导入

---

## 2. 技术设计

### 2.1 导出模块

#### 2.1.1 JSON 导出格式

```json
{
  "version": 1,
  "exportedAt": "2025-12-26T10:30:00Z",
  "conversation": {
    "contactName": "张三",
    "messageCount": 150,
    "messages": [
      {
        "content": "你好",
        "isFromMe": false,
        "kind": "text",
        "senderName": null,
        "order": 0
      }
    ]
  }
}
```

**设计要点**：
- `version` 字段用于版本兼容性处理
- `exportedAt` 记录导出时间
- `kind` 使用字符串而非数字，增强可读性

#### 2.1.2 Markdown 导出格式

```markdown
# 张三

> Exported: December 26, 2025, 10:30
> Messages: 150

---

# System
10:30

# 张三
你好

# Me
你好呀

# 张三
今天天气真好
我们出去玩吧
去公园怎么样？

# System
对方开启了朋友验证

# Me
📷 [Image]
```

**设计要点**：
- 发送者使用一级标题 `# 名字`（便于视觉区分）
- 系统消息使用 `# System` 标题
- "我" 统一使用英文 `Me`
- 消息内容直接跟在发送者标题后（支持多行）
- 图片/语音等特殊消息使用 emoji 标识

### 2.2 导入模块

#### 2.2.1 JSON 导入

- 使用 `Codable` 直接解析 `WechatExportJSON` 结构
- 验证 `version` 字段，处理版本兼容性
- 生成新的 `UUID`，避免 ID 冲突

#### 2.2.2 Markdown 导入

**解析规则**：
1. 文件开头的 `# 标题`（元信息区域前）→ 对话联系人名称
2. `---` 分隔线后的 `# 名字` → 发送者
   - `# Me` 或 `# 我` → isFromMe: true
   - `# System` → kind: .system
   - 其他 → isFromMe: false
3. 发送者标题后的非标题行 → 消息内容（支持多行）
4. `📷 [Image]` 或 `📷 [图片]` → 图片类型消息
5. `🎤 [Voice]` 或 `🎤 [语音]` → 语音类型消息
6. `📋 [Card]` 或 `📋 [卡片]` → 卡片类型消息

**解析流程**：
```
Markdown 文本
    ↓
按行拆分
    ↓
识别标题 → contactName
    ↓
遍历每行，匹配模式
    ↓
构建 [WechatMessage]
    ↓
返回 (contactName, messages)
```

### 2.3 拖拽功能

#### 2.3.1 支持的拖拽类型

| 拖拽内容 | 识别方式 | 触发动作 |
|---------|---------|---------|
| 图片文件 | UTType: `.image` | OCR 识别 |
| JSON 文件 | 扩展名 `.json` | JSON 导入 |
| Markdown 文件 | 扩展名 `.md` | Markdown 导入 |

#### 2.3.2 实现方式

使用 SwiftUI 的 `.onDrop(of:isTargeted:perform:)` 修饰符：

```swift
.onDrop(of: [.fileURL, .image], isTargeted: $isDragTargeted) { providers in
    handleDrop(providers)
    return true
}
```

**拖拽处理流程**：
```
拖拽事件
    ↓
获取 NSItemProvider
    ↓
判断类型（图片 / 文件URL）
    ↓
图片 → OCR 识别流程
文件 → 判断扩展名
    ├── .json → JSON 导入
    └── .md   → Markdown 导入
```

---

## 3. 文件结构

```
Services/DataSources-From/WechatChat/
├── WechatChatExporter.swift      # 导出工具（JSON/MD）
├── WechatChatImporter.swift      # 导入工具（JSON/MD）
└── WechatChatCacheService.swift  # 缓存服务（现有）

ViewModels/WechatChat/
└── WechatChatViewModel.swift     # 添加导入导出方法

Views/WechatChat/
└── WechatChatDetailView.swift    # 添加导出菜单、拖拽支持
```

---

## 4. 实现步骤

### Phase 1: 导出功能

| 步骤 | 任务 | 文件 |
|-----|------|-----|
| 1.1 | 创建 `WechatExportFormat` 枚举（JSON/Markdown） | WechatChatExporter.swift |
| 1.2 | 创建 JSON 导出数据模型 | WechatChatExporter.swift |
| 1.3 | 实现 `exportAsJSON()` 方法 | WechatChatExporter.swift |
| 1.4 | 实现 `exportAsMarkdown()` 方法 | WechatChatExporter.swift |
| 1.5 | 在 ViewModel 添加 `exportConversation()` 方法 | WechatChatViewModel.swift |
| 1.6 | 在 DetailView 添加导出菜单 | WechatChatDetailView.swift |

### Phase 2: 导入功能

| 步骤 | 任务 | 文件 |
|-----|------|-----|
| 2.1 | 创建 `WechatChatImporter` 工具类 | WechatChatImporter.swift |
| 2.2 | 实现 `importFromJSON()` 方法 | WechatChatImporter.swift |
| 2.3 | 实现 `importFromMarkdown()` 方法（正则解析） | WechatChatImporter.swift |
| 2.4 | 在 ViewModel 添加 `importConversation()` 方法 | WechatChatViewModel.swift |
| 2.5 | 在 DetailView 添加导入文件选择器 | WechatChatDetailView.swift |

### Phase 3: 拖拽功能

| 步骤 | 任务 | 文件 |
|-----|------|-----|
| 3.1 | 添加拖拽状态变量（isDragTargeted） | WechatChatDetailView.swift |
| 3.2 | 实现 `.onDrop()` 修饰符 | WechatChatDetailView.swift |
| 3.3 | 实现拖拽处理逻辑（识别类型、分发处理） | WechatChatDetailView.swift |
| 3.4 | 添加拖拽区域视觉反馈（边框高亮） | WechatChatDetailView.swift |

### Phase 4: 测试与优化

| 步骤 | 任务 |
|-----|------|
| 4.1 | 测试导出 JSON → 导入 JSON 的完整闭环 |
| 4.2 | 测试导出 MD → 导入 MD 的完整闭环 |
| 4.3 | 测试图片拖拽触发 OCR |
| 4.4 | 测试文件拖拽触发导入 |
| 4.5 | 边界情况测试（空对话、超长消息、特殊字符） |

---

## 5. API 设计

### 5.1 WechatChatExporter

```swift
enum WechatExportFormat: String, CaseIterable, Identifiable {
    case json = "JSON"
    case markdown = "Markdown"
    
    var fileExtension: String { ... }
    var utType: UTType { ... }
}

enum WechatChatExporter {
    /// 导出对话
    static func export(_ conversation: WechatConversation, format: WechatExportFormat) -> String
    
    /// 生成文件名
    static func generateFileName(contactName: String, format: WechatExportFormat) -> String
}
```

### 5.2 WechatChatImporter

```swift
enum WechatChatImporter {
    /// 从 JSON 导入
    static func importFromJSON(_ jsonString: String) -> (contactName: String, messages: [WechatMessage])?
    
    /// 从 Markdown 导入
    static func importFromMarkdown(_ markdownString: String) -> (contactName: String, messages: [WechatMessage])?
    
    /// 自动检测格式并导入
    static func importFromFile(url: URL) -> (contactName: String, messages: [WechatMessage])?
}
```

### 5.3 ViewModel 方法

```swift
extension WechatChatViewModel {
    /// 导出对话
    func exportConversation(_ contactId: UUID, format: WechatExportFormat) -> String?
    
    /// 导入对话（创建新对话或追加到现有对话）
    func importConversation(from url: URL, appendTo existingContactId: UUID?) async throws -> UUID
}
```

### 5.4 拖拽处理

```swift
extension WechatChatDetailView {
    /// 处理拖拽
    func handleDrop(_ providers: [NSItemProvider]) -> Bool
    
    /// 处理图片拖拽（触发 OCR）
    func handleImageDrop(_ url: URL) async
    
    /// 处理文件拖拽（触发导入）
    func handleFileDrop(_ url: URL) async
}
```

---

## 6. UI 设计

### 6.1 统一 Import/Export 菜单

在工具栏添加统一的"Import/Export"菜单，使用 `arrow.up.arrow.down.circle` 图标：

```
┌─────────────────────────────────┐
│  🔄 Import/Export               │
├─────────────────────────────────┤
│  📷 Import Screenshot (OCR)     │
│  📥 Import from JSON/Markdown   │
├─────────────────────────────────┤
│  📄 Export as JSON              │
│  📝 Export as Markdown          │
└─────────────────────────────────┘
```

### 6.2 拖拽视觉反馈

当文件拖入区域时，显示蓝色覆盖层和提示文字：

```
┌──────────────────────────────────┐
│                                  │
│     ┌────────────────────┐       │
│     │  📥 拖放文件到此处  │       │
│     │ 支持: 图片, JSON, MD │      │
│     └────────────────────┘       │
│                                  │
└──────────────────────────────────┘
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|-----|---------|
| JSON 解析失败 | 显示错误提示，说明格式不正确 |
| Markdown 解析失败 | 显示错误提示，说明无法识别格式 |
| 版本不兼容 | 显示提示，建议更新应用 |
| 文件读取失败 | 显示权限错误或文件不存在提示 |
| 拖拽类型不支持 | 忽略或显示不支持提示 |

---

## 8. 国际化

需要添加的本地化字符串：

| Key | 中文 | 英文 |
|-----|-----|-----|
| export_as_json | 导出为 JSON | Export as JSON |
| export_as_markdown | 导出为 Markdown | Export as Markdown |
| import_conversation | 导入对话 | Import Conversation |
| drop_files_here | 拖放文件到此处 | Drop files here |
| supported_formats | 支持: 图片, JSON, MD | Supported: Image, JSON, MD |
| import_success | 导入成功 | Import Successful |
| import_failed | 导入失败 | Import Failed |
| export_success | 导出成功 | Export Successful |

---

## 9. 待确认问题

1. **导入时创建新对话还是追加到现有对话？**
   - 建议：默认创建新对话，提供选项追加到现有对话

2. **Markdown 导入精度要求？**
   - 建议：尽力解析，无法识别的行作为普通文本消息

3. **是否需要导入确认对话框？**
   - 建议：导入前显示预览（联系人名称、消息数量），用户确认后导入

4. **拖拽多个文件的处理？**
   - 建议：图片批量 OCR，文件逐个导入

---

## 10. 时间估算

| 阶段 | 预计时间 |
|-----|---------|
| Phase 1: 导出功能 | 20 分钟 |
| Phase 2: 导入功能 | 30 分钟 |
| Phase 3: 拖拽功能 | 25 分钟 |
| Phase 4: 测试优化 | 15 分钟 |
| **总计** | **~90 分钟** |

---

## 11. 依赖项

- `UniformTypeIdentifiers`：用于 UTType 判断
- 现有 `WechatModels.swift`：消息和对话模型
- 现有 `WechatChatCacheService.swift`：数据持久化

---

## 12. 实现状态

### ✅ 已完成

| 阶段 | 状态 | 说明 |
|-----|------|-----|
| Phase 1: 导出功能 | ✅ 完成 | `WechatChatExporter.swift` |
| Phase 2: 导入功能 | ✅ 完成 | `WechatChatImporter.swift` |
| Phase 3: ViewModel 集成 | ✅ 完成 | `WechatChatViewModel.swift` |
| Phase 4: UI 集成 | ✅ 完成 | `WechatChatDetailView.swift` |
| Phase 5: 拖拽功能 | ✅ 完成 | 支持图片/JSON/MD 拖拽 |

### 文件清单

- `Services/DataSources-From/WechatChat/WechatChatExporter.swift` - 导出工具
- `Services/DataSources-From/WechatChat/WechatChatImporter.swift` - 导入工具
- `ViewModels/WechatChat/WechatChatViewModel.swift` - 添加导入导出方法
- `Views/WechatChat/WechatChatDetailView.swift` - UI 集成（导出菜单、导入按钮、拖拽支持）
- `Services/DataSources-From/WechatChat/WechatChatCacheService.swift` - 添加 `fetchAllMessages` 方法

### 功能特性

1. **导出功能**
   - JSON 格式：带版本号的结构化数据
   - Markdown 格式：使用 `# 发送者` 标识对话人，系统消息使用 `# System`，"我" 使用 `# Me`
   - 通过菜单选择格式，调用系统文件保存器

2. **导入功能**
   - 支持 JSON 和 Markdown 格式
   - 可追加到现有对话或创建新对话
   - 自动检测文件格式
   - Markdown 解析支持中英文发送者识别（`我` / `Me`）

3. **拖拽功能**
   - 图片拖拽 → OCR 识别
   - JSON/MD 文件拖拽 → 自动导入
   - 拖拽时显示视觉反馈覆盖层
   - 通过复制到临时目录解决跨目录文件访问权限问题

4. **UI 设计**
   - 统一的 Import/Export 菜单（`arrow.up.arrow.down.circle` 图标）
   - 菜单项：
     - Import Screenshot (OCR)
     - Import from JSON/Markdown
     - Export as JSON
     - Export as Markdown

### 技术要点

1. **拖拽文件权限处理**
   - 从 Downloads 等目录拖拽文件时，使用 `Data(contentsOf:)` 直接读取（拖拽授予临时权限）
   - 保存到 `FileManager.default.temporaryDirectory` 后再处理
   - 处理完成后清理临时文件

2. **Markdown 格式规范**
   - 发送者使用一级标题 `# Name`
   - 系统消息使用 `# System`
   - "我" 统一使用英文 `Me`
   - 特殊消息类型使用 emoji 标识：📷 [Image], 🎤 [Voice], 📋 [Card]


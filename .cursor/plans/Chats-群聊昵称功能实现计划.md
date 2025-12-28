# 微信聊天 OCR - 群聊昵称功能实现计划

> **创建日期**：2025-12-28  
> **更新日期**：2025-12-28  
> **状态**：✅ P1/P2 已完成  
> **关联文档**：
> - `.cursor/plans/Chats-OCR-Parsing-TechDoc.md`
> - `.cursor/plans/Chats-OCR-Pending-Tasks.md`

---

## 一、背景与需求

### 1.1 问题描述

当前 Chats OCR 功能仅支持**私聊场景**：
- 消息按左右方向分为"我"和"对方"
- `senderName` 字段始终为 `nil`
- 无法区分群聊中的多个发送者

### 1.2 用户需求

在群聊截图中，用户希望能够：
1. 为消息设置发送者昵称
2. 方便地从本对话已使用的昵称列表中选择
3. 在消息气泡上方显示发送者昵称（微信群聊风格）

### 1.3 设计决策

**放弃自动识别昵称**的原因：
- OCR 输出无语义标签，昵称与消息内容在文本层面无法区分
- 几何规则识别准确率不稳定，受截图分辨率/主题影响
- 群聊中用户只关注少数重要发送者，手动标注更可控

**采用方案**：用户手动设置昵称 + 单对话昵称标签选择器

**不区分私聊/群聊**：所有对话统一处理，昵称字段为可选

---

## 二、功能设计

### 2.1 交互流程

```
用户右键点击消息气泡
    ↓
弹出上下文菜单，包含：
    - 复制
    - ─────────
    - 设为我的消息
    - 设为对方消息
    - 设为系统消息
    - ─────────
    - 设置发送者昵称...  ← 新增
    - 清除昵称           ← 新增（仅当 senderName 非空时显示）
    ↓
点击"设置发送者昵称..."
    ↓
弹出昵称选择/输入 Popover
    ↓
用户选择本对话已使用的昵称 或 输入新昵称
    ↓
确认后：
    - 更新消息的 senderName
    - 持久化到 SwiftData（加密存储）
```

### 2.2 UI 设计

#### 昵称选择/输入 Popover

```
┌─────────────────────────────────────┐
│  设置发送者昵称                       │
│  ────────────────────────────────── │
│  本对话中已使用的昵称：               │
│  ┌─────────────────────────────────┐│
│  │ [信年君] [抄底狂魔苏兄] [None]   ││ ← 从当前对话消息中提取
│  └─────────────────────────────────┘│
│  ────────────────────────────────── │
│  或输入新昵称：                       │
│  ┌─────────────────────────────────┐│
│  │ [                            ]  ││ ← 文本输入框
│  └─────────────────────────────────┘│
│                                      │
│           [取消]    [确定]           │
└─────────────────────────────────────┘
```

**注意**：昵称列表来源于当前对话中所有已设置 senderName 的消息（动态提取，无需额外存储）

#### 消息气泡昵称显示

```
对方消息（有昵称时）：
        ┌────────────────────┐
信年君  │                    │
        │  消息内容...        │
        └────────────────────┘

对方消息（无昵称时）：
        ┌────────────────────┐
        │  消息内容...        │
        └────────────────────┘

我的消息（有昵称时）：
                                     我
                    ┌────────────────────┐
                    │  消息内容...        │
                    └────────────────────┘
（最终决定：我的消息也显示昵称）

系统消息：
        ────────────────────────────────
              系统消息内容...
        ────────────────────────────────
（系统消息不显示昵称，且右键菜单隐藏昵称设置项）
```

**设计决策（2025-12-28 更新）**：
- ✅ "我的消息"和"对方消息"均显示昵称
- ✅ "系统消息"隐藏昵称设置菜单项（右键菜单中不显示）
- ✅ 消息从普通消息改为系统消息后，senderName 数据保留（不删除），便于恢复

### 2.3 数据模型

#### 消息级别（已有字段）

```swift
// ChatMessage.swift - 已有字段
struct ChatMessage {
    let senderName: String?  // ✅ 已预留，当前始终为 nil
    // ...
}

// ChatCacheModels.swift - 已有字段
@Model
class CachedChatMessageV2 {
    var senderNameEncrypted: Data?  // ✅ 已预留，加密存储
    // ...
}
```

#### 单对话昵称列表（动态提取，无需额外存储）

```swift
// 从当前对话消息中提取已使用的昵称
func getUsedSenderNames(for contactId: UUID) -> [String] {
    let messages = getLoadedMessages(for: contactId)
    let names = messages.compactMap { $0.senderName }
    return Array(Set(names)).sorted()  // 去重、排序
}
```

---

## 三、技术实现计划

### 3.1 文件变更清单（已完成）

| 文件 | 变更类型 | 描述 | 状态 |
|------|----------|------|------|
| `ChatSenderNamePickerView.swift` | **新增** | 昵称选择/输入 Popover 视图 + FlowLayout | ✅ |
| `ChatMessageContextMenu.swift` | 修改 | 添加"设置发送者昵称"菜单项，系统消息隐藏 | ✅ |
| `ChatMessageBubble.swift` | 修改 | 显示昵称（我的消息+对方消息均显示） | ✅ |
| `ChatSystemMessageRow.swift` | 修改 | 传递新的 `onSetSenderName/onClearSenderName` 参数 | ✅ |
| `ChatDetailView.swift` | 修改 | 添加 Popover 状态管理和触发逻辑 | ✅ |
| `ChatViewModel.swift` | 修改 | 添加 `updateMessageSenderName()` 和 `getUsedSenderNames()` | ✅ |
| `ChatCacheService.swift` | 修改 | 添加 `updateMessageSenderName()` 协议和实现 | ✅ |
| `ChatCacheModels.swift` | 修改 | 添加 `CachedChatMessageV2.updateSenderName()` 方法 | ✅ |

### 3.2 优先级与任务分解

#### P1 - 核心功能（必须实现）

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P1.1** | 创建 `ChatSenderNamePickerView`（标签选择 + 输入框） | 40 min |
| **P1.2** | 修改 `ChatMessageContextMenu` 添加菜单项 | 20 min |
| **P1.3** | 修改 `ChatViewModel` 添加 `updateMessageSenderName()` | 15 min |
| **P1.4** | 修改 `ChatViewModel` 添加 `getUsedSenderNames()` | 10 min |
| **P1.5** | 修改 `ChatsCacheService` 添加昵称持久化方法 | 20 min |

#### P2 - 显示优化

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P2.1** | 确保 `ChatMessageBubble` 正确显示昵称 | 10 min |
| **P2.2** | 添加"清除昵称"菜单项 | 10 min |
| **P2.3** | 昵称颜色样式（微信蓝 #576B95） | 5 min |

#### P3 - 增强功能（可选）

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P3.1** | 批量设置昵称（多选消息） | 30 min |

---

## 四、详细实现步骤

### 4.1 P1.1 - ChatSenderNamePickerView

**新建文件**：`SyncNos/Views/Chats/Components/ChatSenderNamePickerView.swift`

```swift
import SwiftUI

/// 昵称选择/输入 Popover
struct ChatSenderNamePickerView: View {
    let usedNames: [String]  // 本对话中已使用的昵称
    let currentName: String?
    let onSelect: (String?) -> Void
    let onDismiss: () -> Void
    
    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set Sender Name")
                .scaledFont(.headline)
            
            Divider()
            
            // 本对话已使用的昵称标签区
            if !usedNames.isEmpty {
                Text("Used in this chat:")
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)
                
                FlowLayout(spacing: 6) {
                    ForEach(usedNames, id: \.self) { name in
                        Button {
                            selectName(name)
                        } label: {
                            Text(name)
                                .scaledFont(.callout)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(currentName == name ? Color.accentColor : Color.secondary.opacity(0.15))
                                )
                                .foregroundColor(currentName == name ? .white : .primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                
                Divider()
            }
            
            // 输入新昵称
            Text("Or enter new name:")
                .scaledFont(.subheadline)
                .foregroundColor(.secondary)
            
            TextField("Enter name...", text: $inputText)
                .textFieldStyle(.roundedBorder)
                .focused($isInputFocused)
                .onSubmit {
                    if !inputText.isEmpty {
                        selectName(inputText)
                    }
                }
            
            Divider()
            
            // 按钮区
            HStack {
                Spacer()
                
                Button("Cancel") {
                    onDismiss()
                }
                .keyboardShortcut(.escape)
                
                Button("OK") {
                    if !inputText.isEmpty {
                        selectName(inputText)
                    } else {
                        onDismiss()
                    }
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .frame(width: 280)
        .onAppear {
            inputText = currentName ?? ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isInputFocused = true
            }
        }
    }
    
    private func selectName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSelect(trimmed)
    }
}

/// 简易 FlowLayout（标签流式布局）
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                       y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }
    
    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []
        
        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0
            
            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                if x + size.width > maxWidth, x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }
                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }
            
            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}
```

### 4.2 P1.2 - 修改 ChatMessageContextMenu

**修改文件**：`SyncNos/Views/Chats/Components/ChatMessageContextMenu.swift`

添加"设置发送者昵称"菜单项，需要传递回调来触发 Popover。

### 4.3 P1.3 - 修改 ChatViewModel

**修改文件**：`SyncNos/ViewModels/Chats/ChatViewModel.swift`

```swift
// 新增方法
func updateMessageSenderName(
    messageId: UUID,
    senderName: String?,
    for contactId: UUID
) {
    // 1. 更新 conversations 内存
    // 2. 更新 paginationStates 内存
    // 3. 持久化到 SwiftData
}

func getUsedSenderNames(for contactId: UUID) -> [String] {
    let messages = getLoadedMessages(for: contactId)
    let names = messages.compactMap { $0.senderName }
    return Array(Set(names)).sorted()
}
```

### 4.4 P1.4 - 修改 ChatsCacheService

**修改文件**：`SyncNos/Services/DataSources-From/Chats/ChatsCacheService.swift`

```swift
// 新增方法
func updateMessageSenderName(
    messageId: String,
    senderName: String?
) async throws {
    // 加密并更新 senderNameEncrypted 字段
}
```

---

## 五、测试计划

### 5.1 功能测试

| 测试项 | 预期结果 |
|--------|----------|
| 右键菜单显示"设置发送者昵称" | ✅ 菜单项正常显示（非系统消息） |
| 点击后弹出昵称选择 Popover | ✅ Popover 正常弹出（箭头朝左，显示在右侧） |
| Popover 显示本对话已使用的昵称 | ✅ 标签正确显示 |
| 选择已有昵称 | ✅ 消息昵称更新、Popover 关闭 |
| 输入新昵称并确认 | ✅ 消息昵称更新 |
| 重启应用后昵称保留 | ✅ SwiftData 持久化正常 |
| 消息气泡上方显示昵称 | ✅ 我的消息和对方消息均显示昵称 |
| 清除昵称 | ✅ senderName 设为 nil、气泡不再显示昵称 |
| 系统消息右键菜单 | ✅ 不显示昵称设置菜单项 |

### 5.2 边界测试

| 测试项 | 预期结果 |
|--------|----------|
| 新对话无历史昵称 | ✅ 只显示输入框，无标签区 |
| 输入空白昵称 | ✅ 阻止提交 |
| 我的消息设置昵称 | ✅ 支持并显示昵称 |
| 消息从普通改为系统消息 | ✅ senderName 数据保留 |
| 消息从系统改回普通消息 | ✅ 昵称自动恢复显示 |

---

## 六、后续迭代建议

1. **昵称颜色区分**：不同昵称显示不同颜色（类似微信群聊）
2. ✅ **导出时保留昵称**：JSON/Markdown 导出包含 senderName 字段（已实现）
3. **批量设置昵称**：选中多条消息统一设置

---

## 七、变更日志

| 日期 | 版本 | 描述 |
|------|------|------|
| 2025-12-28 | v1.0 | 初始计划文档 |
| 2025-12-28 | v1.1 | 改为单对话昵称列表（动态提取），移除全局历史存储 |
| 2025-12-28 | v1.2 | ✅ P1/P2 全部完成：右键菜单、昵称弹窗、持久化、气泡显示 |
| 2025-12-28 | v1.3 | 调整：我的消息也显示昵称；系统消息隐藏昵称菜单项 |
| 2025-12-28 | v1.4 | 优化：Popover 位置调整（arrowEdge: .leading，显示在右侧） |
| 2025-12-28 | v1.5 | ✅ 验证完成：导出时保留昵称功能已实现（JSON/Markdown） |

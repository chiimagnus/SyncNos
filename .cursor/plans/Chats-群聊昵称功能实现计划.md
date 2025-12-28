# 微信聊天 OCR - 群聊昵称功能实现计划

> **创建日期**：2025-12-28  
> **状态**：📋 待实现  
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
2. 方便地从历史昵称列表中选择
3. 在消息气泡上方显示发送者昵称（微信群聊风格）

### 1.3 设计决策

**放弃自动识别昵称**的原因：
- OCR 输出无语义标签，昵称与消息内容在文本层面无法区分
- 几何规则识别准确率不稳定，受截图分辨率/主题影响
- 群聊中用户只关注少数重要发送者，手动标注更可控

**采用方案**：用户手动设置昵称 + 历史昵称标签选择器

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
用户选择历史昵称 或 输入新昵称
    ↓
确认后：
    - 更新消息的 senderName
    - 持久化到 SwiftData
    - 新昵称加入全局历史列表
```

### 2.2 UI 设计

#### 昵称选择/输入 Popover

```
┌─────────────────────────────────────┐
│  设置发送者昵称                       │
│  ────────────────────────────────── │
│  历史昵称：                           │
│  ┌─────────────────────────────────┐│
│  │ [信年君] [抄底狂魔苏兄] [None]   ││ ← 可点选的标签
│  │ [王小明] [张三]                  ││
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

我的消息：
                    ┌────────────────────┐
                    │  消息内容...        │
                    └────────────────────┘
（"我的消息"通常不显示昵称，但 senderName 字段可存储）
```

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
    var senderNameEncrypted: Data?  // ✅ 已预留
    // ...
}
```

#### 全局昵称历史列表（新增）

```swift
// 存储位置：UserDefaults
// Key: "chat.sender.name.history"
// Value: [String] - 最近使用的昵称列表（去重、按使用时间排序）
// 最大数量：20 个

final class ChatSenderNameHistoryStore {
    static let shared = ChatSenderNameHistoryStore()
    
    private let key = "chat.sender.name.history"
    private let maxCount = 20
    
    var names: [String] {
        get { UserDefaults.standard.stringArray(forKey: key) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    
    func add(_ name: String) {
        guard !name.isEmpty else { return }
        var list = names.filter { $0 != name }  // 去重
        list.insert(name, at: 0)  // 最新使用的放最前面
        if list.count > maxCount {
            list = Array(list.prefix(maxCount))
        }
        names = list
    }
    
    func remove(_ name: String) {
        names = names.filter { $0 != name }
    }
}
```

---

## 三、技术实现计划

### 3.1 文件变更清单

| 文件 | 变更类型 | 描述 |
|------|----------|------|
| `ChatSenderNameHistoryStore.swift` | **新增** | 全局昵称历史列表存储 |
| `ChatSenderNamePickerView.swift` | **新增** | 昵称选择/输入 Popover 视图 |
| `ChatMessageContextMenu.swift` | 修改 | 添加"设置发送者昵称"菜单项 |
| `ChatMessageBubble.swift` | 修改 | 显示发送者昵称 |
| `ChatViewModel.swift` | 修改 | 添加 `updateMessageSenderName()` |
| `ChatsCacheService.swift` | 修改 | 添加昵称更新方法 |

### 3.2 优先级与任务分解

#### P1 - 核心功能（必须实现）

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P1.1** | 创建 `ChatSenderNameHistoryStore` | 15 min |
| **P1.2** | 创建 `ChatSenderNamePickerView` | 45 min |
| **P1.3** | 修改 `ChatMessageContextMenu` 添加菜单项 | 20 min |
| **P1.4** | 修改 `ChatViewModel` 添加 `updateMessageSenderName()` | 15 min |
| **P1.5** | 修改 `ChatsCacheService` 添加昵称持久化方法 | 20 min |

#### P2 - 显示优化

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P2.1** | 修改 `ChatMessageBubble` 显示昵称 | 15 min |
| **P2.2** | 添加"清除昵称"菜单项 | 10 min |
| **P2.3** | 昵称颜色样式（微信蓝 #576B95） | 10 min |

#### P3 - 增强功能（可选）

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| **P3.1** | 批量设置昵称（多选消息） | 30 min |
| **P3.2** | 昵称历史管理（删除不常用昵称） | 20 min |

---

## 四、详细实现步骤

### 4.1 P1.1 - ChatSenderNameHistoryStore

**新建文件**：`SyncNos/Services/DataSources-From/Chats/ChatSenderNameHistoryStore.swift`

```swift
import Foundation

/// 全局昵称历史列表存储
/// - 存储位置：UserDefaults
/// - 最大数量：20 个
/// - 排序：按最近使用时间（最新在前）
final class ChatSenderNameHistoryStore: ObservableObject {
    static let shared = ChatSenderNameHistoryStore()
    
    private let key = "chat.sender.name.history"
    private let maxCount = 20
    
    @Published private(set) var names: [String] = []
    
    private init() {
        names = UserDefaults.standard.stringArray(forKey: key) ?? []
    }
    
    /// 添加昵称到历史列表（自动去重、排序、限制数量）
    func add(_ name: String) {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        
        var list = names.filter { $0 != trimmed }
        list.insert(trimmed, at: 0)
        
        if list.count > maxCount {
            list = Array(list.prefix(maxCount))
        }
        
        names = list
        UserDefaults.standard.set(list, forKey: key)
    }
    
    /// 从历史列表中移除昵称
    func remove(_ name: String) {
        names = names.filter { $0 != name }
        UserDefaults.standard.set(names, forKey: key)
    }
    
    /// 清空历史列表
    func clear() {
        names = []
        UserDefaults.standard.removeObject(forKey: key)
    }
}
```

### 4.2 P1.2 - ChatSenderNamePickerView

**新建文件**：`SyncNos/Views/Chats/Components/ChatSenderNamePickerView.swift`

```swift
import SwiftUI

/// 昵称选择/输入 Popover
struct ChatSenderNamePickerView: View {
    @Binding var isPresented: Bool
    let currentName: String?
    let onSelect: (String?) -> Void
    
    @StateObject private var historyStore = ChatSenderNameHistoryStore.shared
    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("设置发送者昵称")
                .font(.headline)
            
            Divider()
            
            // 历史昵称标签区
            if !historyStore.names.isEmpty {
                Text("历史昵称：")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                FlowLayout(spacing: 6) {
                    ForEach(historyStore.names, id: \.self) { name in
                        Button {
                            selectName(name)
                        } label: {
                            Text(name)
                                .font(.callout)
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
            Text("或输入新昵称：")
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            HStack {
                TextField("输入昵称...", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .focused($isInputFocused)
                    .onSubmit {
                        if !inputText.isEmpty {
                            selectName(inputText)
                        }
                    }
            }
            
            Divider()
            
            // 按钮区
            HStack {
                Spacer()
                
                Button("取消") {
                    isPresented = false
                }
                .keyboardShortcut(.escape)
                
                Button("确定") {
                    if !inputText.isEmpty {
                        selectName(inputText)
                    } else {
                        isPresented = false
                    }
                }
                .keyboardShortcut(.return)
                .disabled(inputText.isEmpty && currentName == nil)
            }
        }
        .padding()
        .frame(width: 300)
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
        
        historyStore.add(trimmed)
        onSelect(trimmed)
        isPresented = false
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

### 4.3 P1.3 - 修改 ChatMessageContextMenu

**修改文件**：`SyncNos/Views/Chats/Components/ChatMessageContextMenu.swift`

添加"设置发送者昵称"和"清除昵称"菜单项。

### 4.4 P1.4 - 修改 ChatViewModel

**修改文件**：`SyncNos/ViewModels/Chats/ChatViewModel.swift`

添加 `updateMessageSenderName()` 方法。

### 4.5 P1.5 - 修改 ChatsCacheService

**修改文件**：`SyncNos/Services/DataSources-From/Chats/ChatsCacheService.swift`

添加昵称持久化方法。

---

## 五、测试计划

### 5.1 功能测试

| 测试项 | 预期结果 |
|--------|----------|
| 右键菜单显示"设置发送者昵称" | ✅ 菜单项正常显示 |
| 点击后弹出昵称选择 Popover | ✅ Popover 正常弹出 |
| 选择历史昵称 | ✅ 消息昵称更新、Popover 关闭 |
| 输入新昵称并确认 | ✅ 消息昵称更新、新昵称加入历史列表 |
| 重启应用后历史昵称保留 | ✅ UserDefaults 持久化正常 |
| 消息气泡上方显示昵称 | ✅ 仅对方消息显示昵称 |
| 清除昵称 | ✅ senderName 设为 nil、气泡不再显示昵称 |

### 5.2 边界测试

| 测试项 | 预期结果 |
|--------|----------|
| 历史昵称达到 20 个上限 | ✅ 自动移除最旧的昵称 |
| 输入空白昵称 | ✅ 阻止提交 |
| 输入已存在的历史昵称 | ✅ 移到列表最前面（去重） |
| 我的消息设置昵称 | ✅ 支持（但默认不显示） |

---

## 六、后续迭代建议

1. **昵称颜色区分**：不同昵称显示不同颜色（类似微信群聊）
2. **昵称头像绑定**：支持为昵称设置头像（可选）
3. **智能昵称建议**：基于 OCR 识别的"疑似昵称"区域，提供建议（需优化几何规则）
4. **导出时保留昵称**：JSON/Markdown 导出包含 senderName 字段

---

## 七、变更日志

| 日期 | 版本 | 描述 |
|------|------|------|
| 2025-12-28 | v1.0 | 初始计划文档 |


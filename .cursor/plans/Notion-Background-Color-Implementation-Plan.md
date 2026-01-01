# Notion 背景颜色支持实现计划

> **创建日期**：2026-01-01
> **完成日期**：2026-01-01
> **状态**：✅ 已完成（P1 + P2 + P3 + P4）

## 1. 需求分析

### 1.1 功能目标

为 Chats 消息内容和其他数据源的高亮笔记在 Notion 中添加相应的**背景颜色**，使不同类型的内容在视觉上更容易区分。

### 1.2 当前状态

| 组件 | 状态 | 说明 |
|------|------|------|
| `HighlightColorScheme` | ✅ 已定义 | 各数据源颜色映射已定义（包括 Chats） |
| `UnifiedHighlight.colorIndex` | ⚠️ 部分使用 | Chats 设为 nil，其他数据源有值 |
| `buildNoteChildren` | ❌ 未使用颜色 | 只设置了 italic，无背景颜色 |

### 1.3 Notion API 支持的背景颜色

| 颜色名 | API 值 |
|--------|--------|
| 灰色 | `gray_background` |
| 棕色 | `brown_background` |
| 橙色 | `orange_background` |
| 黄色 | `yellow_background` |
| 绿色 | `green_background` |
| 蓝色 | `blue_background` |
| 紫色 | `purple_background` |
| 粉色 | `pink_background` |
| 红色 | `red_background` |

### 1.4 各数据源颜色映射（已定义在 HighlightColorScheme）

#### Apple Books
| Index | Notion Color | Display Name |
|-------|--------------|--------------|
| 0 | orange | Orange |
| 1 | green | Green |
| 2 | blue | Blue |
| 3 | yellow | Yellow |
| 4 | pink | Pink |
| 5 | purple | Purple |

#### GoodLinks
| Index | Notion Color | Display Name |
|-------|--------------|--------------|
| 0 | yellow | Yellow |
| 1 | green | Green |
| 2 | blue | Blue |
| 3 | red | Red |
| 4 | purple | Purple |
| 5 | mint | Mint |

> ⚠️ **注意**：`mint` 不是 Notion 支持的背景颜色，需要改为其他颜色。

#### WeRead
| Index | Notion Color | Display Name |
|-------|--------------|--------------|
| 0 | red | Red |
| 1 | purple | Purple |
| 2 | blue | Blue |
| 3 | green | Green |
| 4 | yellow | Yellow |

#### Dedao
| Index | Notion Color | Display Name |
|-------|--------------|--------------|
| 0 | orange | Default |

#### Chats
| Index | Notion Color | Display Name |
|-------|--------------|--------------|
| 0 | blue | From Me |
| 1 | green | From Others |
| 2 | gray | System |

---

## 2. 实施计划

### P1: 修复 GoodLinks 颜色映射（必须）

**优先级**：P1-HIGH
**原因**：`mint` 不是 Notion 支持的背景颜色，会导致 API 错误或被忽略。

**文件**：`SyncNos/Models/Core/HighlightColorScheme.swift`

**修改内容**：
```swift
case .goodLinks:
    return [
        HighlightColorDefinition(index: 0, notionName: "yellow", displayName: "Yellow"),
        HighlightColorDefinition(index: 1, notionName: "green", displayName: "Green"),
        HighlightColorDefinition(index: 2, notionName: "blue", displayName: "Blue"),
        HighlightColorDefinition(index: 3, notionName: "red", displayName: "Red"),
        HighlightColorDefinition(index: 4, notionName: "purple", displayName: "Purple"),
        // 修改: mint → brown (Notion 不支持 mint)
        HighlightColorDefinition(index: 5, notionName: "brown", displayName: "Brown")
    ]
```

同时修改 fallback：
```swift
case .goodLinks:
    // 修改: mint → brown
    return HighlightColorDefinition(index: index, notionName: "brown", displayName: "Brown")
```

---

### P2: 为 Chats 消息设置 colorIndex（必须）

**优先级**：P2-HIGH
**原因**：当前 Chats 的 `colorIndex` 设为 nil，需要根据消息方向设置颜色。

**文件**：`SyncNos/Models/Core/UnifiedHighlight.swift`

**修改位置**：`init(from message: ChatMessage, contactName: String)` 方法

**修改内容**：
```swift
init(from message: ChatMessage, contactName: String) {
    self.uuid = message.id.uuidString
    
    // text 存储 sender name（将作为 Notion 中的父块）
    if let senderName = message.senderName, !senderName.isEmpty {
        self.text = senderName
    } else if message.isFromMe {
        self.text = "Me"
    } else {
        self.text = contactName
    }
    
    // note 存储消息内容（将作为 Notion 中的子块）
    self.note = message.content
    
    // 根据消息类型设置颜色索引（用于 Notion 背景颜色）
    // 0 = blue (From Me), 1 = green (From Others), 2 = gray (System)
    switch message.kind {
    case .system:
        self.colorIndex = 2  // gray
    case .text, .image:
        self.colorIndex = message.isFromMe ? 0 : 1  // blue or green
    }
    
    self.dateAdded = nil
    self.dateModified = nil
    self.location = nil
    self.source = .chats
}
```

---

### P3: 修改 buildNoteChildren 支持背景颜色（核心）

**优先级**：P3-CRITICAL
**原因**：这是实现背景颜色的核心修改。

**文件**：`SyncNos/Services/DataSources-To/Notion/Core/NotionHelperMethods.swift`

**修改内容**：

1. 添加辅助方法获取背景颜色：
```swift
/// 获取 Notion 背景颜色名（添加 _background 后缀）
/// - Parameters:
///   - style: 颜色索引
///   - source: 数据源标识符
/// - Returns: Notion 背景颜色名，如 "blue_background"
func backgroundColorName(for style: Int?, source: String) -> String? {
    guard let style = style else { return nil }
    let colorName = styleName(for: style, source: source)
    return "\(colorName)_background"
}
```

2. 修改 `buildNoteChildren` 方法签名，添加 source 和 style 参数：
```swift
/// 将 note 切分为多个兄弟 bulleted_list_item 子块
/// - Parameters:
///   - highlight: 高亮数据
///   - chunkSize: 每块最大字符数
///   - source: 数据源标识符（用于颜色映射）
/// - Returns: Notion block 数组
func buildNoteChildren(
    for highlight: HighlightRow,
    chunkSize: Int = NotionSyncConfig.maxTextLengthPrimary,
    source: String = "appleBooks"
) -> [[String: Any]] {
    guard let note = highlight.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty else { return [] }
    
    let chunks = chunkText(note, chunkSize: chunkSize)
    let bgColor = backgroundColorName(for: highlight.style, source: source)
    
    return chunks.map { chunk in
        var annotations: [String: Any] = ["italic": true]
        if let color = bgColor {
            annotations["color"] = color
        }
        
        return [
            "object": "block",
            "bulleted_list_item": [
                "rich_text": [[
                    "text": ["content": chunk],
                    "annotations": annotations
                ]]
            ]
        ]
    }
}
```

3. 更新所有调用 `buildNoteChildren` 的地方，传递 `source` 参数：

**文件**：`NotionHelperMethods.swift`
- `buildParentAndChildren` 方法（已有 source 参数，只需传递）

---

### P4: 更新 styleName 支持 Chats 和 Dedao 数据源（可选增强）

**优先级**：P4-MEDIUM
**原因**：当前 `styleName` 方法只处理 appleBooks、goodLinks、weRead，不支持 dedao 和 chats。

**文件**：`SyncNos/Services/DataSources-To/Notion/Core/NotionHelperMethods.swift`

**修改内容**：
```swift
func styleName(for style: Int, source: String = "appleBooks") -> String {
    let src: HighlightSource
    switch source {
    case "goodLinks":
        src = .goodLinks
    case "weRead":
        src = .weRead
    case "dedao":
        src = .dedao
    case "chats":
        src = .chats
    default:
        src = .appleBooks
    }
    let def = HighlightColorScheme.definition(for: style, source: src)
    return def.notionName
}
```

---

## 3. 验证清单

### P1 验证 ✅
- [x] GoodLinks 颜色映射 index=5 改为 brown
- [x] GoodLinks fallback 改为 brown
- [x] 编译无错误

### P2 验证 ✅
- [x] Chats 消息 colorIndex 正确设置：
  - `isFromMe=true` → colorIndex=0 (blue)
  - `isFromMe=false` → colorIndex=1 (green)
  - `kind=.system` → colorIndex=2 (gray)
- [x] 编译无错误

### P3 验证 ✅
- [x] `backgroundColorName` 方法正确返回背景颜色名
- [x] `buildNoteChildren` 方法正确设置 annotations.color
- [x] 所有调用点正确传递 source 参数
- [x] 编译无错误
- [ ] 实际同步到 Notion 后背景颜色正确显示（需用户测试）

### P4 验证 ✅
- [x] `styleName` 支持 dedao 和 chats
- [x] 编译无错误

---

## 4. 文件修改汇总

| 文件 | 修改内容 | 优先级 |
|------|----------|--------|
| `Models/Core/HighlightColorScheme.swift` | 修复 GoodLinks mint → brown | P1 |
| `Models/Core/UnifiedHighlight.swift` | 为 Chats 设置 colorIndex | P2 |
| `Services/DataSources-To/Notion/Core/NotionHelperMethods.swift` | 添加 backgroundColorName；修改 buildNoteChildren；更新 styleName | P3, P4 |

---

## 5. 实施顺序

1. **P1**: 修复 GoodLinks 颜色映射 → 验证 → Build
2. **P2**: 为 Chats 设置 colorIndex → 验证 → Build
3. **P3**: 修改 buildNoteChildren 支持背景颜色 → 验证 → Build
4. **P4**: 更新 styleName 支持所有数据源 → 验证 → Build

---

## 6. 技术说明

### 6.1 Notion API 颜色设置

在 Notion API 中，rich_text 的 annotations 对象支持以下颜色属性：

```json
{
  "annotations": {
    "bold": false,
    "italic": true,
    "color": "blue_background"  // 背景颜色
  }
}
```

支持的颜色值：
- **前景色**：`default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`
- **背景色**：添加 `_background` 后缀，如 `blue_background`

### 6.2 为什么使用 buildNoteChildren 而非父块

消息/笔记内容放在子块（bulleted_list_item）中，使用 annotations.color 设置背景颜色。父块保持 UUID 和元数据的灰色背景，保持一致性。

### 6.3 颜色语义

| 数据源 | 颜色含义 |
|--------|----------|
| Apple Books | 用户选择的高亮颜色 |
| GoodLinks | 用户选择的高亮颜色 |
| WeRead | 用户选择的划线颜色 |
| Dedao | 统一橙色（无颜色信息） |
| Chats | 蓝=我发送，绿=对方发送，灰=系统消息 |

---

## 7. 预期效果

### Chats 消息同步后在 Notion 中的展示

```
1. [uuid:xxx]
   style:blue | modified:xxx
   Me                          ← 蓝色背景
     • 你好，今天天气真好        ← 蓝色背景

2. [uuid:yyy]
   style:green | modified:xxx
   朋友                         ← 绿色背景
     • 是啊，适合出去走走        ← 绿色背景

3. [uuid:zzz]
   style:gray | modified:xxx
   System                       ← 灰色背景
     • 下午 3:00                ← 灰色背景
```

### Apple Books / GoodLinks / WeRead 高亮同步后

每条高亮的笔记（note）子块将显示对应的背景颜色，与原应用中的高亮颜色对应。


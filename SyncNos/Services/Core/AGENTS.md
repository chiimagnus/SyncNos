# Core Services 规范

本目录包含 SyncNos 的核心服务，包括依赖注入、日志、加密、字体缩放等基础设施。

---

## SyncNos 动态字体使用规范（macOS 自定义字体缩放）

本项目采用自定义字体缩放方案（非系统 Dynamic Type）。实现位于 `FontScaleManager.swift`。

### 核心组件

- **FontScaleManager.shared**
  - 属性：`scaleLevel`（离散等级）、`scaleFactor`（CGFloat）、`isAccessibilitySize`
  - 存储键：`SyncNos.FontScaleLevel`
  - 通知：`Notification.Name.fontScaleDidChange`
- **环境键**：`fontScale`（通过 `.applyFontScale()` 注入）
- **文本修饰符**：`scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil)`
- **视图修饰符**：`.applyFontScale()`（将 `fontScale` 注入当前视图层级）
- **辅助工具**：`Font.TextStyle.basePointSize`、`AdaptiveStack`

---

### 编码规范

#### 1. 文本必须使用 `.scaledFont()`

```swift
// ❌ 禁止
Text("Title").font(.headline)

// ✅ 正确
Text("Title").scaledFont(.headline, weight: .semibold)
```

#### 2. 根视图注入缩放

对需要字体缩放的窗口/根视图调用 `.applyFontScale()`（已用于 `RootView`、`SettingsView` 等）。

新增独立窗口或顶层视图时，请确认添加。

#### 3. 获取缩放因子：推荐方式

```swift
// ✅ 首选：Environment
@Environment(\.fontScale) var fontScale

// ✅ 备选：ObservedObject（仅当需要 isAccessibilitySize 等属性时）
@ObservedObject private var fontScaleManager = FontScaleManager.shared

// ❌ 禁止：不要使用 @EnvironmentObject
// .applyFontScale() 只注入了 Environment(\.fontScale)，未注入 environmentObject
```

#### 4. 图标与布局尺寸缩放

使用 `fontScale` 手工计算：

```swift
Image(systemName: "star")
    .font(.system(size: 40 * fontScale))
```

#### 5. 特殊字体（等宽等）

需要 monospaced 时手动计算：

```swift
Font.system(size: Font.TextStyle.caption.basePointSize * fontScale, design: .monospaced)
```

---

### 禁止事项

- ❌ 不使用 `@ScaledMetric`、`DynamicTypeSize`（macOS 不响应）
- ❌ 不直接写死 `.font(.system(size: ... * fontScale))` 来替代 `.scaledFont()`，除非是非文本元素或特殊字体场景

---

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| ⌘+ | 放大字体（Increase Text Size） |
| ⌘- | 缩小字体（Decrease Text Size） |
| ⌘0 | 重置字体（Reset Text Size） |

快捷键实现位于 `Views/Commands/ViewCommands.swift`，调用 `FontScaleManager` 的 `increaseSize()`、`decreaseSize()`、`reset()` 方法。

---

### 参考文件

| 文件 | 描述 |
|------|------|
| `Services/Core/FontScaleManager.swift` | 核心实现 |
| `Views/Commands/ViewCommands.swift` | 菜单命令 |
| `Views/Settings/General/TextSizeSettingsView.swift` | 设置界面 |

---

## DIContainer 服务注册

所有服务通过 `DIContainer.swift` 统一管理。添加新服务时：

1. 添加私有变量：`private var _xxxService: XxxServiceProtocol?`
2. 添加计算属性：`var xxxService: XxxServiceProtocol { ... }`
3. （可选）添加注册方法：`func register(xxxService:)`

### 示例

```swift
// DIContainer.swift
private var _myService: MyServiceProtocol?

var myService: MyServiceProtocol {
    if _myService == nil {
        _myService = MyService()
    }
    return _myService!
}
```

---

## 日志服务

使用 `LoggerService` 进行统一日志记录：

```swift
let logger = DIContainer.shared.loggerService
logger.info("[Module] Message")
logger.error("[Module] Error: \(error)")
logger.debug("[Module] Debug info")
```

### 日志级别

| 级别 | 用途 |
|------|------|
| `debug` | 调试信息，仅开发环境 |
| `info` | 一般信息，操作记录 |
| `warning` | 警告，非致命问题 |
| `error` | 错误，需要关注 |

---

## 加密服务

`EncryptionService` 提供本地数据加密（AES-256-GCM + Keychain）：

```swift
let encryptionService = DIContainer.shared.encryptionService
let encrypted = try encryptionService.encrypt(data)
let decrypted = try encryptionService.decrypt(encrypted)
```

用于 Chats 消息的本地存储加密。

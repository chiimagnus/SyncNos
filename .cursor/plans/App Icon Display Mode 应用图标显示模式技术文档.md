# App Icon Display Mode 应用图标显示模式

## 功能概述

SyncNos 支持三种应用图标显示模式，允许用户自定义应用在系统中的呈现方式：

| 模式 | 说明 | Dock 显示 | 菜单栏显示 |
|------|------|-----------|------------|
| **In the Menu Bar and Dock** | 同时显示（默认） | ✅ | ✅ |
| **In the Menu Bar** | 仅在菜单栏显示 | ❌ | ✅ |
| **In the Dock** | 仅在 Dock 显示 | ✅ | ❌ |

## 架构设计

### 文件结构

```
SyncNos/
├── Models/Core/
│   └── AppIconDisplayMode.swift      # 显示模式枚举定义
├── ViewModels/Settings/
│   └── AppIconDisplayViewModel.swift  # 模式切换业务逻辑
├── Views/Settings/General/
│   └── SettingsView.swift             # UI 选择器（Picker）
├── SyncNosApp.swift                   # MenuBarExtra 动态控制
└── AppDelegate.swift                  # 启动时应用设置
```

### 核心组件

#### 1. AppIconDisplayMode（枚举）

```swift
enum AppIconDisplayMode: Int, CaseIterable, Identifiable {
    case both = 0         // 两者都显示（默认）
    case menuBarOnly = 1  // 仅菜单栏
    case dockOnly = 2     // 仅 Dock
    
    var showsMenuBarIcon: Bool { ... }  // 是否显示菜单栏图标
    var showsDockIcon: Bool { ... }     // 是否显示 Dock 图标
    var displayName: String { ... }     // 本地化显示名称
    
    static var current: AppIconDisplayMode { get set }  // UserDefaults 存取
}
```

**存储**：使用 `UserDefaults` 键 `appIconDisplayMode` 持久化。

**默认值**：`0`（`.both`），确保新用户默认同时在菜单栏和 Dock 显示。由于 `UserDefaults.integer(forKey:)` 对未设置的键返回 `0`，将 `.both` 设为 `rawValue = 0` 可自然实现默认值。

#### 2. AppIconDisplayViewModel（视图模型）

```swift
@MainActor
final class AppIconDisplayViewModel: ObservableObject {
    @Published var selectedMode: AppIconDisplayMode
    
    func applyDisplayMode(_ mode: AppIconDisplayMode)  // 应用模式
    static func applyStoredMode()                       // 启动时调用
}
```

**职责**：
- 监听用户选择变化，自动应用
- 更新 `NSApplication.activationPolicy`
- 发送通知 `AppIconDisplayModeChanged`

#### 3. SyncNosApp（应用入口）

```swift
@main
struct SyncNosApp: App {
    @AppStorage("appIconDisplayMode") private var iconDisplayModeRaw: Int = 0
    
    private var menuBarIconInserted: Binding<Bool> { ... }  // 动态控制
    
    var body: some Scene {
        MenuBarExtra("SyncNos", image: "MenuBarIcon", isInserted: menuBarIconInserted) {
            MenuBarView()
        }
    }
}
```

**关键技术**：使用 `MenuBarExtra(isInserted:)` API（macOS 14+）动态控制菜单栏图标可见性。

#### 4. AppDelegate（生命周期）

```swift
func applicationDidFinishLaunching(_ notification: Notification) {
    AppIconDisplayViewModel.applyStoredMode()
}
```

**重要**：必须在 `applicationDidFinishLaunching` 中调用，不能在 `App.init()` 中调用，因为此时 `NSApp` 尚未初始化。

## 技术实现细节

### NSApplication.ActivationPolicy

macOS 使用 `activationPolicy` 控制应用在 Dock 中的显示：

| Policy | Dock 显示 | 说明 |
|--------|-----------|------|
| `.regular` | ✅ | 普通应用（默认） |
| `.accessory` | ❌ | 无 Dock 图标的辅助应用 |
| `.prohibited` | ❌ | 禁止激活的后台代理 |

### MenuBarExtra isInserted

SwiftUI 的 `MenuBarExtra` 支持 `isInserted: Binding<Bool>` 参数：
- `true`：菜单栏图标可见
- `false`：菜单栏图标隐藏

用户也可以从系统菜单栏手动移除图标，此时 Binding 会被设为 `false`。

### 模式切换实现

**核心逻辑**：使用同步方式设置 `activationPolicy`，避免与 SwiftUI 状态更新冲突。

```swift
private static func updateActivationPolicyStatic(for mode: AppIconDisplayMode) {
    guard let app = NSApp else { return }
    
    let currentPolicy = app.activationPolicy()
    let newPolicy: NSApplication.ActivationPolicy = mode == .menuBarOnly ? .accessory : .regular
    
    // 如果策略没有变化，直接返回
    guard currentPolicy != newPolicy else { return }
    
    // 同步设置策略
    app.setActivationPolicy(newPolicy)
    
    // 如果从 accessory 切换到 regular，需要激活应用
    if currentPolicy == .accessory && newPolicy == .regular {
        app.activate(ignoringOtherApps: true)
    }
}
```

### 数据流

```
用户选择模式
      ↓
AppIconDisplayViewModel.$selectedMode
      ↓
┌─────────────────────────────────────┐
│ applyDisplayMode(_:)                │
│   1. 保存到 UserDefaults            │
│   2. 更新 activationPolicy          │
│   3. 发送通知                        │
└─────────────────────────────────────┘
      ↓
SyncNosApp.@AppStorage 响应变化
      ↓
menuBarIconInserted Binding 更新
      ↓
MenuBarExtra 显示/隐藏
```

## 踩坑记录

### 1. NSApp 在 App.init() 阶段为 nil

**问题**：在 `SyncNosApp.init()` 中调用 `NSApp.setActivationPolicy()` 导致崩溃。

**原因**：SwiftUI App 的 `init()` 在 `NSApplication` 完全初始化之前执行。

**解决**：将调用移至 `AppDelegate.applicationDidFinishLaunching()`。

### 2. 切换到 Dock 模式时应用卡死

**问题**：从 "In the Menu Bar" 切换到 "In the Dock" 时应用无响应。

**原因**：使用 `DispatchQueue.main.async` 包装 `setActivationPolicy()` 调用，可能与 SwiftUI 状态更新形成死锁或竞态条件。

**解决**：改为同步调用，移除异步包装。

### 3. 默认值不正确

**问题**：新安装的应用默认显示模式不是 "In the Menu Bar and Dock"。

**原因**：`UserDefaults.integer(forKey:)` 对未设置的键返回 `0`，但之前 `.menuBarOnly = 0`。

**解决**：重新排列枚举值，使 `.both = 0` 成为默认值。

### 4. Binding setter 重复触发

**问题**：用户选择模式后，Binding setter 可能被重复调用导致冲突。

**原因**：当 `menuBarIconInserted.get()` 返回 `false` 时，SwiftUI 会调用 setter，可能再次触发 `applyStoredMode()`。

**解决**：在 setter 中添加条件检查，避免在模式已经是 `.dockOnly` 时重复处理。

```swift
set: { newValue in
    let currentMode = AppIconDisplayMode(rawValue: iconDisplayModeRaw) ?? .both
    // 只在用户从菜单栏手动移除图标时处理
    if !newValue && currentMode != .dockOnly {
        // ...
    }
}
```

## 注意事项

### MenuBarExtra 与 activationPolicy 的协调

当切换到 `.menuBarOnly` 模式时：
1. `activationPolicy` 设为 `.accessory`（隐藏 Dock）
2. `menuBarIconInserted` 设为 `true`（显示菜单栏）

当切换到 `.dockOnly` 模式时：
1. `activationPolicy` 设为 `.regular`（显示 Dock）
2. `menuBarIconInserted` 设为 `false`（隐藏菜单栏）

### 用户手动移除菜单栏图标

如果用户从系统偏好设置或菜单栏手动移除图标，`isInserted` Binding 会被设为 `false`。我们在 setter 中处理这种情况，自动切换到 `.dockOnly` 模式。

## 国际化

支持 16 种语言的本地化字符串：

| 键 | 英文 | 中文 |
|----|------|------|
| `Display SyncNos icon` | Display SyncNos icon | 显示 SyncNos 图标 |
| `In the Menu Bar and Dock` | In the Menu Bar and Dock | 在菜单栏和 Dock 中 |
| `In the Menu Bar` | In the Menu Bar | 在菜单栏中 |
| `In the Dock` | In the Dock | 在 Dock 中 |

## 测试要点

1. **启动测试**：验证新安装的应用默认显示模式为 "In the Menu Bar and Dock"
2. **切换测试**：验证三种模式切换时 Dock 和菜单栏图标的显示/隐藏
3. **持久化测试**：验证设置在应用重启后保持
4. **无卡死测试**：验证从任意模式切换到任意模式都不会卡死
5. **边界情况**：验证用户手动从菜单栏移除图标时的行为

## 相关 API 参考

- [NSApplication.ActivationPolicy](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy)
- [MenuBarExtra(isInserted:)](https://developer.apple.com/documentation/swiftui/menubarextra/init(_:image:isinserted:content:)-1bubh/)

---

*最后更新: 2025年12月26日*

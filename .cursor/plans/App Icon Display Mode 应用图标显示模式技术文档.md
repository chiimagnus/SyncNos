# App Icon Display Mode 应用图标显示模式

## 功能概述

SyncNos 支持三种应用图标显示模式，允许用户自定义应用在系统中的呈现方式：

| 模式 | 说明 | Dock 显示 | 菜单栏显示 |
|------|------|-----------|------------|
| **In the Menu Bar** | 仅在菜单栏显示 | ❌ | ✅ |
| **In the Dock** | 仅在 Dock 显示 | ✅ | ❌ |
| **In the Menu Bar and Dock** | 同时显示（默认） | ✅ | ✅ |

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
    case menuBarOnly = 0  // 仅菜单栏
    case dockOnly = 1     // 仅 Dock
    case both = 2         // 两者都显示（默认）
    
    var showsMenuBarIcon: Bool { ... }  // 是否显示菜单栏图标
    var showsDockIcon: Bool { ... }     // 是否显示 Dock 图标
    var displayName: String { ... }     // 本地化显示名称
    
    static var current: AppIconDisplayMode { get set }  // UserDefaults 存取
}
```

**存储**：使用 `UserDefaults` 键 `appIconDisplayMode` 持久化。

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
    @AppStorage("appIconDisplayMode") private var iconDisplayModeRaw: Int = 2
    
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

## 注意事项

### 1. NSApp 初始化时机

```swift
// ❌ 错误：App.init() 中 NSApp 为 nil
init() {
    AppIconDisplayViewModel.applyStoredMode()  // 崩溃！
}

// ✅ 正确：在 AppDelegate.applicationDidFinishLaunching 中调用
func applicationDidFinishLaunching(_ notification: Notification) {
    AppIconDisplayViewModel.applyStoredMode()  // NSApp 已初始化
}
```

### 2. MenuBarExtra 与 activationPolicy 的协调

当切换到 `.menuBarOnly` 模式时：
1. `activationPolicy` 设为 `.accessory`（隐藏 Dock）
2. `menuBarIconInserted` 设为 `true`（显示菜单栏）

当切换到 `.dockOnly` 模式时：
1. `activationPolicy` 设为 `.regular`（显示 Dock）
2. `menuBarIconInserted` 设为 `false`（隐藏菜单栏）

### 3. 用户手动移除菜单栏图标

如果用户从系统偏好设置或菜单栏手动移除图标，`isInserted` Binding 会被设为 `false`。我们在 setter 中处理这种情况：

```swift
set: { newValue in
    if !newValue {
        iconDisplayModeRaw = AppIconDisplayMode.dockOnly.rawValue
        AppIconDisplayViewModel.applyStoredMode()
    }
}
```

## 国际化

支持 16 种语言的本地化字符串：

| 键 | 英文 | 中文 |
|----|------|------|
| `Display SyncNos icon` | Display SyncNos icon | 显示 SyncNos 图标 |
| `In the Menu Bar` | In the Menu Bar | 在菜单栏中 |
| `In the Dock` | In the Dock | 在 Dock 中 |
| `In the Menu Bar and Dock` | In the Menu Bar and Dock | 在菜单栏和 Dock 中 |

## 测试要点

1. **启动测试**：验证应用启动时正确加载保存的设置
2. **切换测试**：验证三种模式切换时 Dock 和菜单栏图标的显示/隐藏
3. **持久化测试**：验证设置在应用重启后保持
4. **边界情况**：验证用户手动从菜单栏移除图标时的行为

## 相关 API 参考

- [NSApplication.ActivationPolicy](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy)
- [MenuBarExtra(isInserted:)](https://developer.apple.com/documentation/swiftui/menubarextra/init(_:image:isinserted:content:)-1bubh/)

---

*最后更新: 2025年12月26日*

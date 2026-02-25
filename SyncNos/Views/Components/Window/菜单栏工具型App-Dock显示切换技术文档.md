# 菜单栏工具型 App：主窗口打开时显示 Dock、关窗后隐藏 Dock（SyncNos 实践）

## 背景

SyncNos 提供「Display SyncNos icon」设置（见 `Models/Core/AppIconDisplayMode.swift`、`ViewModels/Settings/AppIconDisplayViewModel.swift`），允许用户选择：

- 仅菜单栏（`menuBarOnly`）
- 仅 Dock（`dockOnly`）
- 菜单栏 + Dock（`both`）

其中 `menuBarOnly` 是典型的“菜单栏工具型 App”模式：平时不出现在 Dock，但当用户打开主窗口进行操作时，希望它**像正常 App 一样出现在 Dock**；关闭主窗口后则回到“仅菜单栏”状态。

本技术文档记录 SyncNos 中实现该行为的工程化方案，便于在其它 macOS App（如同类工具型 App）复用。

---

## 目标与非目标

### 目标

在 `AppIconDisplayMode.current == .menuBarOnly` 时：

1. 打开主窗口 → 应用出现在 Dock，并激活到前台。
2. 关闭主窗口（⌘W）且此时没有其它可见窗口 → 应用从 Dock 消失（但菜单栏图标仍可用）。

在 `dockOnly` / `both` 时：

- Dock 显示策略遵循原有逻辑，不做“临时隐藏”。

### 非目标

- 不改变 SyncNos 现有的窗口结构（`Window(id: "main")` / `Window(id: "setting")` / `Window(id: "log")` 仍由 SwiftUI Scene 管理）。
- 不强行干预绿灯/全屏按钮行为。
- 不引入新的国际化字段或修改已有本地化字符串。

---

## 关键 API 与原理

macOS 上 Dock 图标显示/隐藏的核心 API 是：

- `NSApplication.setActivationPolicy(_:)`
  - `.regular`：标准 App（有 Dock 图标 + 菜单栏命令菜单）
  - `.accessory`：配件模式（无 Dock 图标；通常用于菜单栏工具）

关键点：

- 不能在 `App.init()` 里直接依赖 `NSApp`（可能尚未初始化）；应使用 `NSApplication.shared` 或延迟到 AppDelegate 的 `applicationDidFinishLaunching`。
- 当从 `.accessory` 切换到 `.regular` 时，通常需要调用 `activate(ignoringOtherApps:)` 才能获得正确前台体验。

---

## SyncNos 的实现结构

### 1) DockPresenceService：统一策略入口（只关心“是否允许隐藏”）

文件：`SyncNos/Services/Core/DockPresenceService.swift`

职责：

- `prepareForPresentingMainWindow()`
  - 若当前模式是 `menuBarOnly`：确保 activation policy 切到 `.regular`
  - 总是 `activate(ignoringOtherApps: true)`，让用户点击菜单栏“Open SyncNos”后立即聚焦
- `hideDockIfAllowedWhenNoVisibleWindows()`
  - 仅在 `menuBarOnly` 下生效
  - 当“没有任何可见且可成为主窗口的窗口”时，切回 `.accessory`

实现细节（重要）：

- 过滤窗口时使用 `isVisible && canBecomeMain`
  - 避免把菜单栏 popover / 临时面板当成“仍有窗口”，导致 Dock 无法隐藏

### 2) MainWindowDockVisibilityController：只绑定“主窗口”，监听窗口事件

文件：`SyncNos/Views/Components/Window/MainWindowDockVisibilityController.swift`

职责：

- 当主窗口 `didBecomeMain`：调用 `DockPresenceService.prepareForPresentingMainWindow()`
- 当主窗口 `willClose`：异步调用 `DockPresenceService.hideDockIfAllowedWhenNoVisibleWindows()`

为什么要监听 `didBecomeMain`？

- 在一些时序下（比如窗口被系统带到前台、或来自 Dock 的 reopen 行为），单靠菜单栏按钮触发不够稳。
- `didBecomeMain` 能保证“只要主窗口成为主窗口”就进入 `.regular`。

### 3) RootView 接入：复用现有 WindowReader 拿到主窗口 NSWindow

文件：`SyncNos/Views/RootView.swift`

SyncNos 已有 `WindowReader`（`Views/Components/Keyboard/WindowReader.swift`）用于拿到 SwiftUI scene 对应的 `NSWindow`。

在 `RootView` 的 `.background(WindowReader(...))` 回调中：

- 继续把 window 传给 `MainWindowStayOnTopController`
- 同时把 window 传给 `MainWindowDockVisibilityController`

这样可以保证绑定的是 SwiftUI `Window(id: "main")` 对应的“主窗口”，而不是 Settings/Logs 等其它窗口。

### 4) MenuBarView 接入：打开主窗口前先执行 Dock 准备

文件：`SyncNos/Views/Settings/General/MenuBarView.swift`

菜单栏菜单项 “Open SyncNos” 的逻辑变为：

1. `DockPresenceService.prepareForPresentingMainWindow()`
2. `openWindow(id: "main")`

这覆盖了最常见的用户路径：从菜单栏打开主窗口。

### 5) AppDelegate：关闭最后一个窗口时回到菜单栏形态（覆盖 Settings/Logs）

文件：`SyncNos/AppDelegate.swift`

新增/使用：

- `applicationShouldTerminateAfterLastWindowClosed(_:) -> Bool`
  - 调用 `DockPresenceService.hideDockIfAllowedWhenNoVisibleWindows()`
  - 返回 `false`（不退出 app，只调整 Dock 形态）

该钩子由系统保证在“最后一个窗口关闭”时触发，避免手写“是否还有窗口”的复杂判断。

---

## 行为矩阵（最终效果）

| 当前显示模式 | 打开主窗口 | 关闭最后窗口（⌘W） | Dock 是否常驻 |
|---|---|---|---|
| `menuBarOnly` | 临时出现在 Dock（`.regular`） | 回到仅菜单栏（`.accessory`） | 否 |
| `dockOnly` | 仍是 Dock App（`.regular`） | 不隐藏 Dock | 是 |
| `both` | 仍是 Dock App（`.regular`） | 不隐藏 Dock | 是 |

---

## 迁移到其它 App 的最小 Checklist

若你在另一个 macOS App 想复用该交互（例如：SyncNos 的其它分支/新项目），建议按以下步骤落地：

1. 确保 App 支持 `.regular`（能出现在 Dock）
   - 工程里不要把 `LSUIElement` 固定为 `YES`（否则会一直是“纯菜单栏 App”语义）
2. 增加 `DockPresenceService`
   - 提供 `prepareForPresentingMainWindow()`、`hideDockIfAllowedWhenNoVisibleWindows()`
3. 获取主窗口的 `NSWindow`
   - SwiftUI 项目优先复用 `NSViewRepresentable` 的 window reader（和 SyncNos `WindowReader` 同思路）
4. 在主窗口生命周期绑定监听
   - `didBecomeMain` → show dock
   - `willClose` / “最后窗口关闭” → hide dock（仅允许时）
5. 菜单栏入口打开窗口前显式 `prepareForPresentingMainWindow()`

---

## 手测清单（SyncNos）

1. 设置为「In the Menu Bar」
   - 菜单栏点击 “Open SyncNos” → 出现在 Dock 且前台激活
   - `⌘W` 关闭主窗口 → Dock 图标消失，菜单栏图标仍在
2. 设置为「In the Dock」/「In the Menu Bar and Dock」
   - 打开/关闭窗口都不应触发 Dock 隐藏
3. 打开 Settings / Logs 后关闭主窗口
   - 若还有 Settings/Logs 可见，Dock 不应隐藏（因为仍有可成为 main 的可见窗口）

---

## 常见问题与排查

### 1) 为什么要在隐藏 Dock 前判断 “没有可见窗口”？

如果仍有可见窗口（尤其是 Settings/Logs），把 activation policy 切回 `.accessory` 会造成：

- 用户仍在操作某个窗口，但 Dock 图标突然消失，体验割裂
- 菜单栏命令菜单也会随之变化（甚至暂时不可用）

因此在 `menuBarOnly` 下隐藏 Dock 必须是“无窗口的后台态”。

### 2) 为什么窗口过滤要用 `isVisible && canBecomeMain`？

菜单栏 popover / 某些临时面板可能被 AppKit 视为 `NSWindow`，但它们不是我们要的“应用正在展示主界面窗口”。

使用 `canBecomeMain` 过滤能明显降低误判率，避免 Dock 无法正确隐藏。


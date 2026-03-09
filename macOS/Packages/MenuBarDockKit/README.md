# MenuBarDockKit

抽象「菜单栏工具型 App」的通用能力：

- App 图标显示模式（菜单栏 / Dock / 两者）
- 在 `.menuBarOnly` 模式下：打开主窗口期间临时显示 Dock，关闭窗口后恢复隐藏
- 菜单栏 Popover（`NSStatusItem` + `NSPopover`）
- SwiftUI 读取 `NSWindow` 的 `WindowReader`

该包为 **macOS 14+**。


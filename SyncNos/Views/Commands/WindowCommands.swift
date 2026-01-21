import SwiftUI

// MARK: - Window Commands
struct WindowCommands: Commands {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    var body: some Commands {
        // 隐藏窗口列表（Settings、Logs、主窗口等不再显示在 Window 菜单）
        CommandGroup(replacing: .windowList) {}

        // MARK: - Text Size Commands
        CommandGroup(replacing: .singleWindowList) {
            Button(String(localized: "Increase Text Size", table: "Common")) {
                fontScaleManager.increaseSize()
            }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(!fontScaleManager.canIncreaseSize)

            Button(String(localized: "Decrease Text Size", table: "Common")) {
                fontScaleManager.decreaseSize()
            }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!fontScaleManager.canDecreaseSize)

            Button(String(localized: "Reset Text Size", table: "Common")) {
                fontScaleManager.reset()
            }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(fontScaleManager.isDefaultSize)
        }
    }
}


import SwiftUI

// MARK: - Window Commands
struct WindowCommands: Commands {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    var body: some Commands {
        // 禁用"Single Window List"（系统默认，通常用于文档类应用）
        // MARK: - Text Size Commands
        CommandGroup(replacing: .singleWindowList) {
            Button("Increase Text Size") {
                fontScaleManager.increaseSize()
            }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(!fontScaleManager.canIncreaseSize)

            Button("Decrease Text Size") {
                fontScaleManager.decreaseSize()
            }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!fontScaleManager.canDecreaseSize)

            Button("Reset Text Size") {
                fontScaleManager.reset()
            }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(fontScaleManager.isDefaultSize)
        }
    }
}


import SwiftUI

// MARK: - Edit Commands
struct EditCommands: Commands {
    @FocusedValue(\.selectionCommands) private var selectionCommands: SelectionCommands?

    var body: some Commands {
        // Edit 菜单 - 编辑操作相关
        // 替换剪贴板命令组，但显式添加 Copy/Cut/Paste 以保留文本字段的快捷键功能
        CommandGroup(replacing: .pasteboard) {
            // 保留系统默认的 Copy 命令（用于文本字段）
            Button("Copy", systemImage: "doc.on.doc") {
                NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("c", modifiers: .command)

            // 保留系统默认的 Cut 命令（用于文本字段）
            Button("Cut", systemImage: "scissors") {
                NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("x", modifiers: .command)

            // 保留系统默认的 Paste 命令（用于文本字段）
            Button("Paste", systemImage: "doc.on.clipboard") {
                NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("v", modifiers: .command)

            Divider()

            // 自定义的 Select All（用于列表视图选择）
            Button("Select All", systemImage: "character.textbox") {
                selectionCommands?.selectAll()
            }
            .keyboardShortcut("a", modifiers: [.command])
            .disabled(!(selectionCommands?.canSelectAll() ?? false))

            // 自定义的 Deselect（用于列表视图）
            Button("Deselect", systemImage: "character.textbox.badge.sparkles") {
                selectionCommands?.deselectAll()
            }
            .keyboardShortcut(.escape)
            .disabled(!(selectionCommands?.canDeselect() ?? false))
        }
    }
}

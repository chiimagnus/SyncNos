import SwiftUI

// MARK: - Edit Commands
struct EditCommands: Commands {
    @FocusedValue(\.selectionCommands) private var selectionCommands: SelectionCommands?

    var body: some Commands {
        // Edit 菜单 - 编辑操作相关（仅在列表获得焦点时启用）
        CommandGroup(replacing: .pasteboard) {
            Button("Select All", systemImage: "character.textbox") {
                selectionCommands?.selectAll()
            }
            .keyboardShortcut("a", modifiers: [.command])
            .disabled(!(selectionCommands?.canSelectAll() ?? false))

            Button("Deselect", systemImage: "character.textbox.badge.sparkles") {
                selectionCommands?.deselectAll()
            }
            .keyboardShortcut(.escape)
            .disabled(!(selectionCommands?.canDeselect() ?? false))
        }
    }
}

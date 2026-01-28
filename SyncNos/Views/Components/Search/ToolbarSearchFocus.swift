import AppKit

// MARK: - Toolbar Search Focus

enum ToolbarSearchFocus {
    @MainActor
    static func focusIfPossible() {
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow else { return }

        if let toolbar = window.toolbar {
            if let searchItem = toolbar.items.first(where: { $0 is NSSearchToolbarItem }) as? NSSearchToolbarItem {
                window.makeFirstResponder(searchItem.searchField)
                return
            }

            for item in toolbar.items {
                if let view = item.view, let searchField = findSearchField(in: view) {
                    window.makeFirstResponder(searchField)
                    return
                }
            }
        }
    }

    private static func findSearchField(in view: NSView) -> NSSearchField? {
        if let field = view as? NSSearchField {
            return field
        }

        for subview in view.subviews {
            if let found = findSearchField(in: subview) {
                return found
            }
        }

        return nil
    }
}

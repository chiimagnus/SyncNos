import SwiftUI

// MARK: - SyncSelectedToNotionContextMenuItem

struct SyncSelectedToNotionContextMenuItem: View {
    let selectionIds: Set<String>
    let fallbackId: String
    let action: (Set<String>) -> Void

    var body: some View {
        Button {
            let effectiveIds: Set<String> = selectionIds.isEmpty ? Set([fallbackId]) : selectionIds
            action(effectiveIds)
        } label: {
            Label("Sync Selected to Notion", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
        }
    }
}


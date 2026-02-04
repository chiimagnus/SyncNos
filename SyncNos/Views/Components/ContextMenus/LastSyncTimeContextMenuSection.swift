import Foundation
import SwiftUI

// MARK: - LastSyncTimeContextMenuSection

struct LastSyncTimeContextMenuSection: View {
    let lastSyncAt: Date?

    var body: some View {
        Divider()

        if let lastDate = lastSyncAt {
            Text("Last Sync Time") + Text(": ") + Text(DateFormatter.localizedString(from: lastDate, dateStyle: .short, timeStyle: .short))
        } else {
            Text("Last Sync Time") + Text(": ") + Text("-")
        }
    }
}


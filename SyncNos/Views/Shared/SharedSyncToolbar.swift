import SwiftUI

struct SharedSyncToolbar: View {
    let isSyncing: Bool
    let progressText: String?
    let label: String
    let help: String
    let action: () -> Void

    init(
        isSyncing: Bool,
        progressText: String?,
        label: String = "Sync",
        help: String = "Sync highlights to Notion",
        action: @escaping () -> Void
    ) {
        self.isSyncing = isSyncing
        self.progressText = progressText
        self.label = label
        self.help = help
        self.action = action
    }

    var body: some View {
        Group {
            if isSyncing {
                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.8)
                    if let progress = progressText {
                        Text(progress).font(.caption)
                    } else {
                        Text("Syncing...").font(.caption)
                    }
                }
                .help("Sync in progress")
            } else {
                Button(action: action) {
                    Label(label, systemImage: "arrow.triangle.2.circlepath")
                }
                .help(help)
            }
        }
    }
}



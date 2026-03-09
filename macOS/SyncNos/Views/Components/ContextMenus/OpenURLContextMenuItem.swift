import AppKit
import SwiftUI

// MARK: - OpenURLContextMenuItem

struct OpenURLContextMenuItem: View {
    let title: String
    let systemImage: String
    let url: URL?

    var body: some View {
        Button {
            guard let url else { return }
            NSWorkspace.shared.open(url)
        } label: {
            Label(title, systemImage: systemImage)
        }
        .disabled(url == nil)
    }
}


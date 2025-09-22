import Foundation
import AppKit

/// Shared picker for selecting the Apple Books container directory.
/// Use `AppleBooksPicker.pickAppleBooksContainer()` from UI code.
public struct AppleBooksPicker {
    public static func pickAppleBooksContainer() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "Please choose the Apple Books container directory (com.apple.iBooksX) or its Data/Documents path"

        let home = NSHomeDirectory()
        let defaultContainer = "\(home)/Library/Containers/com.apple.iBooksX"
        panel.directoryURL = URL(fileURLWithPath: defaultContainer, isDirectory: true)

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            // Persist security-scoped bookmark for future launches
            BookmarkStore.shared.save(folderURL: url)
            _ = BookmarkStore.shared.startAccessing(url: url)
            let selectedPath = url.path
            // Determine root and notify other views
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("AppleBooksContainerSelected"), object: selectedPath)
            }
        }
    }
}



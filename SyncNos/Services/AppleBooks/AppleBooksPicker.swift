import Foundation
import AppKit

/// Shared picker for selecting the Apple Books container directory.
/// Use `AppleBooksPicker.pickAppleBooksContainer()` from UI code.
public struct AppleBooksPicker {
    public static func pickAppleBooksContainer(defaultPath: String? = nil) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "Please choose the Apple Books container directory (com.apple.iBooksX) or BKAgentService (com.apple.BKAgentService), or their Data/Documents path"

        let home = NSHomeDirectory()
        let fallbackContainer = "\(home)/Library/Containers/com.apple.iBooksX"
        let initial = defaultPath ?? fallbackContainer
        panel.directoryURL = URL(fileURLWithPath: initial, isDirectory: true)

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
    /// Convenience: pick local Books storage under BKAgentService
    public static func pickLocalBooksContainer() {
        let home = NSHomeDirectory()
        let path = "\(home)/Library/Containers/com.apple.BKAgentService"
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "Please choose the local Books container directory (com.apple.BKAgentService) or its Data/Documents path"
        panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            BookmarkStore.shared.saveLocal(folderURL: url)
            _ = BookmarkStore.shared.startAccessing(url: url)
            let selectedPath = url.path
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("AppleBooksLocalContainerSelected"), object: selectedPath)
            }
        }
    }

    /// Convenience: pick iCloud Books directory "~/Library/Mobile Documents/iCloud~com~apple~iBooks/Documents"
    public static func pickICloudBooksDirectory() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Mobile Documents/iCloud~com~apple~iBooks/Documents")
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "Please choose the iCloud Books Documents directory"
        panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            BookmarkStore.shared.saveICloudBooks(folderURL: url)
            _ = BookmarkStore.shared.startAccessing(url: url)
            let selectedPath = url.path
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("AppleBooksICloudDirectorySelected"), object: selectedPath)
            }
        }
    }
}

import Foundation
import AppKit

/// 让用户选择 iCloud Books 目录，保存安全作用域书签。
/// 通常位于 ~/Library/Mobile Documents/iCloud~com~apple~iBooks/Documents
public struct ICloudBooksPicker {
    public static func pickICloudBooksFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "请选择 iCloud Books 目录（iCloud~com~apple~iBooks/Documents）以允许读取书籍文件"

        let home = NSHomeDirectory()
        let defaultICloudBooks = "\(home)/Library/Mobile Documents/iCloud~com~apple~iBooks/Documents"
        panel.directoryURL = URL(fileURLWithPath: defaultICloudBooks, isDirectory: true)

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            ICloudBooksBookmarkStore.shared.save(folderURL: url)
            _ = ICloudBooksBookmarkStore.shared.startAccessing(url: url)
        }
    }
}



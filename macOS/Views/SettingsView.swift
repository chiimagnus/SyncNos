import SwiftUI
import AppKit

struct SettingsView: View {
    @State private var showNotionIntegration = false
    @State private var isLoading: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Settings")
                .font(.title2)

            HStack(spacing: 12) {
                Button(action: pickAppleBooksContainer) {
                    HStack {
                        Image(systemName: "book")
                        Text("Open Apple Books notes")
                    }
                }
                .help("Choose Apple Books container directory and load notes")

                Button(action: { showNotionIntegration = true }) {
                    HStack {
                        Image(systemName: "n.square")
                        Text("Notion Integration")
                    }
                }
                .help("Configure Notion and run example API calls")
            }

            Spacer()
        }
        .padding()
        .frame(minWidth: 420, minHeight: 160)
        .sheet(isPresented: $showNotionIntegration) {
            NotionIntegrationView()
        }
    }

    // Replicate the Apple Books picker behavior from BooksListView
    private func pickAppleBooksContainer() {
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
            // Determine root and trigger reload via DI or Notification
            DispatchQueue.main.async {
                // Attempt to locate BooksListView's BookViewModel via notification
                NotificationCenter.default.post(name: Notification.Name("AppleBooksContainerSelected"), object: selectedPath)
            }
        }
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}



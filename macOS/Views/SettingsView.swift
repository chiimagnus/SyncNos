import SwiftUI
import AppKit

struct SettingsView: View {
    @State private var isLoading: Bool = false

    var body: some View {
        NavigationStack {
            List {
            Section(header: Text("General")) {
                Button(action: pickAppleBooksContainer) {
                    Label("Open Apple Books notes", systemImage: "book")
                }
                .help("Choose Apple Books container directory and load notes")
            }

            Section(header: Text("Integrations")) {
                // Use NavigationLink so NotionIntegrationView is pushed onto the navigation stack
                NavigationLink(destination: NotionIntegrationView()) {
                    Label("Notion Integration", systemImage: "n.square")
                }
                .help("Configure Notion and run example API calls")
            }
            }
            .listStyle(SidebarListStyle())
            .frame(minWidth: 200, minHeight: 200)
        }
        .navigationTitle("Settings")
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
        NavigationStack {
            SettingsView()
        }
    }
}



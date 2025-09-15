import SwiftUI
import AppKit

struct SettingsView: View {
    @State private var isLoading: Bool = false

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("General")) {
                    Button(action: AppleBooksPicker.pickAppleBooksContainer) {
                        Label("Open Apple Books notes", systemImage: "book")
                    }
                    .help("Choose Apple Books container directory and load notes")
                }
                .collapsible(false)

                Section(header: Text("Integrations")) {
                    NavigationLink(destination: NotionIntegrationView()) {
                        Label("Notion Integration", systemImage: "n.square")
                    }
                    .help("Configure Notion and run example API calls")
                }
                .collapsible(false)
            }
            .listStyle(SidebarListStyle())
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem {
                Text("")
            }
        }
        .frame(minWidth: 320, idealWidth: 375, maxWidth: 375)
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

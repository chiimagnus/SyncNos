import SwiftUI
import AppKit

struct NotionIntegrationView: View {
    @StateObject private var viewModel = NotionIntegrationViewModel()
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        List {
            Section(header: Text("Sync Mode for Apple Books")) {
                Picker("Mode", selection: $viewModel.syncMode) {
                    Text("Single Database (One page per book)").tag("single")
                    Text("One database per book (Each highlight as an entry)").tag("perBook")
                }
                .onChange(of: viewModel.syncMode) { _ in
                    viewModel.saveSyncMode()
                }
            }

            Section(header: Text("Credentials")) {
                LabeledContent("NOTION_KEY") {
                    SecureField("NOTION_KEY", text: $viewModel.notionKeyInput)
                        .textFieldStyle(.roundedBorder)
                }

                LabeledContent("NOTION_PAGE_ID") {
                    TextField("NOTION_PAGE_ID", text: $viewModel.notionPageIdInput)
                        .textFieldStyle(.roundedBorder)
                }

                Divider()

                // Optional per-source DB IDs
                LabeledContent("AppleBooks DB ID (optional)") {
                    TextField("SyncNos-AppleBooks DB ID", text: $viewModel.appleBooksDbId)
                        .textFieldStyle(.roundedBorder)
                }

                LabeledContent("GoodLinks DB ID (optional)") {
                    TextField("SyncNos-GoodLinks DB ID", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                }

                Button("Save") {
                    viewModel.saveCredentials()
                }
                .buttonStyle(.borderedProminent)
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .foregroundColor(.secondary)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Notion Integration")
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
    }
}

import SwiftUI

struct NotionIntegrationView: View {
    @StateObject private var viewModel = NotionIntegrationViewModel()
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        Form {
            VStack(alignment: .leading, spacing: 16) {
                GroupBox("Sync Mode") {
                    Picker("Mode", selection: $viewModel.syncMode) {
                        Text("Single Database (One page per book)").tag("single")
                        Text("One database per book (Each highlight as an entry)").tag("perBook")
                    }
                    .onChange(of: viewModel.syncMode) { _ in
                        viewModel.saveSyncMode()
                    }
                    .padding(8)
                }
                
                GroupBox("Credentials") {
                    VStack(alignment: .leading, spacing: 8) {
                        SecureField("NOTION_KEY", text: $viewModel.notionKeyInput)
                            .textFieldStyle(.roundedBorder)
                        TextField("NOTION_PAGE_ID", text: $viewModel.notionPageIdInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Save") {
                            viewModel.saveCredentials()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(8)
                }
                
                if let message = viewModel.message {
                    Text(message).foregroundColor(.secondary)
                }
                
                Spacer()
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Notion Integration")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button(action: { dismiss() }) {
                    Label("Back", systemImage: "chevron.left")
                }
            }
        }
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
    }
}

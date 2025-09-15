import SwiftUI

struct NotionIntegrationView: View {
    @StateObject private var viewModel = NotionIntegrationViewModel()
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        Form {
            VStack(alignment: .leading, spacing: 16) {
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
                
                GroupBox("1. Create a new database") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Database title", text: $viewModel.databaseTitleInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Create Database") {
                            Task { await viewModel.createDatabase() }
                        }
                        .disabled(viewModel.isBusy)
                        if let id = viewModel.createdDatabaseId { Text("Database ID: \(id)").font(.caption) }
                    }
                    .padding(8)
                }
                
                GroupBox("2. Add a page to the database") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Page title", text: $viewModel.pageTitleInput)
                            .textFieldStyle(.roundedBorder)
                        TextField("Header (optional)", text: $viewModel.headerTextInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Create Page") {
                            Task { await viewModel.createPage() }
                        }
                        .disabled(viewModel.isBusy || viewModel.createdDatabaseId == nil)
                        if let id = viewModel.createdPageId { Text("Page ID: \(id)").font(.caption) }
                    }
                    .padding(8)
                }

                GroupBox("2b. Create a page in an existing database") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Existing Database ID", text: $viewModel.existingDatabaseIdInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Use as default for future syncs") {
                            DIContainer.shared.notionConfigStore.syncDatabaseId = viewModel.existingDatabaseIdInput.trimmingCharacters(in: .whitespacesAndNewlines)
                            viewModel.message = "Saved default database id"
                        }
                        .buttonStyle(.bordered)
                        TextField("Page title (for existing DB)", text: $viewModel.existingDbPageTitleInput)
                            .textFieldStyle(.roundedBorder)
                        TextField("Header (optional)", text: $viewModel.existingDbHeaderInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Create Page in Existing DB") {
                            Task { await viewModel.createPage(inDatabaseId: viewModel.existingDatabaseIdInput) }
                        }
                        .disabled(viewModel.isBusy || viewModel.existingDatabaseIdInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(8)
                }
                
                GroupBox("3. Add content to the page") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Paragraph content", text: $viewModel.pageContentInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Append Paragraph") {
                            Task { await viewModel.appendContent() }
                        }
                        .disabled(viewModel.isBusy || viewModel.createdPageId == nil)
                    }
                    .padding(8)
                }

                GroupBox("3b. Create content in an existing page") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Existing Page ID", text: $viewModel.existingPageIdInput)
                            .textFieldStyle(.roundedBorder)
                        TextField("Content to append", text: $viewModel.existingPageContentInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Append to Existing Page") {
                            Task { await viewModel.appendContent(toPageId: viewModel.existingPageIdInput) }
                        }
                        .disabled(viewModel.isBusy || viewModel.existingPageIdInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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

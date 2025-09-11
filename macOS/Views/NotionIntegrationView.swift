import SwiftUI

struct NotionIntegrationView: View {
    @StateObject private var viewModel = NotionIntegrationViewModel()
    
    var body: some View {
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
            
            if let message = viewModel.message {
                Text(message).foregroundColor(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .frame(minWidth: 520, minHeight: 520)
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
    }
}



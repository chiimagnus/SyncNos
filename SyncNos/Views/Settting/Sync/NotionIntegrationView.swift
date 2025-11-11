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

            Section(header: Text("Authorization")) {
                if viewModel.isOAuthAuthorized {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("OAuth Authorized")
                                .font(.headline)
                        }
                        
                        if let workspaceName = viewModel.workspaceName {
                            Text("Workspace: \(workspaceName)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .lineLimit(nil)
                        }
                        
                        // 当前父页面（用于在此页面下创建数据库）
                        if !viewModel.notionPageIdInput.isEmpty {
                            LabeledContent("Parent Page ID") {
                                Text(viewModel.notionPageIdInput)
                                    .font(.callout)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Button {
                            viewModel.openPagePicker()
                        } label: {
                            HStack(spacing: 6) {
                                if viewModel.isBusy {
                                    ProgressView().scaleEffect(0.8)
                                }
                                Text(viewModel.notionPageIdInput.isEmpty ? "Select Parent Page" : "Change Parent Page")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        
                        Button("Revoke Authorization") {
                            viewModel.revokeOAuth()
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.vertical, 4)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Use OAuth to authorize SyncNos to access your Notion workspace. This is the recommended method.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(nil)
                        
                        Button(action: {
                            viewModel.authorizeWithOAuth()
                        }) {
                            HStack {
                                if viewModel.isAuthorizing {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                }
                                Text(viewModel.isAuthorizing ? "Authorizing..." : "Authorize with Notion")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isAuthorizing)
                    }
                    .padding(.vertical, 4)
                }
                
                Divider()
                
                Text("Or manually enter credentials:")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                LabeledContent("NOTION_KEY") {
                    SecureField("NOTION_KEY", text: $viewModel.notionKeyInput)
                        .textFieldStyle(.roundedBorder)
                        .disabled(viewModel.isOAuthAuthorized)
                }

                LabeledContent("NOTION_PAGE_ID") {
                    TextField("NOTION_PAGE_ID", text: $viewModel.notionPageIdInput)
                        .textFieldStyle(.roundedBorder)
                }

                Button("Save") {
                    viewModel.saveCredentials()
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isOAuthAuthorized)
            }
            
            Section(header: Text("Database IDs")) {
                // Optional per-source DB IDs
                LabeledContent("AppleBooks DB ID (optional)") {
                    // Now read-only; moved to AppleBooksSettingsView
                    Text(viewModel.appleBooksDbId.isEmpty ? "(moved to AppleBooks settings)" : viewModel.appleBooksDbId)
                        .foregroundColor(.secondary)
                }

                LabeledContent("GoodLinks DB ID (optional)") {
                    // Now read-only; moved to GoodLinksSettingsView
                    Text(viewModel.goodLinksDbId.isEmpty ? "(moved to GoodLinks settings)" : viewModel.goodLinksDbId)
                        .foregroundColor(.secondary)
                }
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .foregroundColor(.secondary)
                        .lineLimit(nil)
                }
            }
            
            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .lineLimit(nil)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Notion API")
        .sheet(isPresented: $viewModel.isPagePickerPresented) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Select a Notion Page")
                    .font(.headline)
                TextField("Search", text: $viewModel.pageSearchText)
                    .textFieldStyle(.roundedBorder)
                List {
                    let items = viewModel.availablePages.filter { p in
                        let q = viewModel.pageSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
                        if q.isEmpty { return true }
                        return p.title.localizedCaseInsensitiveContains(q) || p.id.localizedCaseInsensitiveContains(q)
                    }
                    ForEach(items) { page in
                        Button {
                            viewModel.selectPage(page)
                        } label: {
                            HStack {
                                if let e = page.iconEmoji, !e.isEmpty {
                                    Text(e)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(page.title.isEmpty ? "Untitled" : page.title)
                                    Text(page.id)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack {
                    Spacer()
                    Button("Close") {
                        viewModel.isPagePickerPresented = false
                    }
                }
            }
            .padding()
            .frame(minWidth: 520, minHeight: 420)
        }
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
    }
}

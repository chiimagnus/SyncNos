import SwiftUI

struct NotionIntegrationView: View {
    @StateObject private var viewModel = NotionIntegrationViewModel()
    @Environment(\.dismiss) private var dismiss
    
    private func pageDisplayText(_ page: NotionPageSummary) -> String {
        let emoji = page.iconEmoji ?? ""
        let title = page.title.isEmpty ? "Untitled" : page.title
        return emoji.isEmpty ? title : "\(emoji) \(title)"
    }
    
    var body: some View {
        List {
            Section(header: Text(String(localized: "Authorization", table: "Settings")).scaledFont(.headline)) {
                if viewModel.isOAuthAuthorized {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text(String(localized: "OAuth Authorized", table: "Settings"))
                                .scaledFont(.headline)
                        }
                        
                        if let workspaceName = viewModel.workspaceName {
                            Text("Workspace: \(workspaceName)")
                                .scaledFont(.subheadline)
                                .foregroundColor(.secondary)
                                .lineLimit(nil)
                        }
                        
                        // 当前父页面（用于在此页面下创建数据库）
                        LabeledContent {
                            HStack(spacing: 8) {
                                Picker(selection: Binding(
                                    get: {
                                        // 加载中时返回空字符串以显示 "Loading..."
                                        if viewModel.isBusy {
                                            return ""
                                        }
                                        // 确保当前值在可用页面列表中，否则返回空字符串以避免 Picker 警告
                                        let currentId = viewModel.notionPageIdInput
                                        guard !currentId.isEmpty,
                                              viewModel.availablePages.contains(where: { $0.id == currentId }) else {
                                            return ""
                                        }
                                        return currentId
                                    },
                                    set: { newId in
                                        guard !newId.isEmpty,
                                              let page = viewModel.availablePages.first(where: { $0.id == newId }) else {
                                            return
                                        }
                                        viewModel.selectPage(page)
                                    }
                                )) {
                                    if viewModel.isBusy {
                                        Text(String(localized: "Loading...", table: "Common"))
                                            .scaledFont(.body)
                                            .tag("")
                                    } else if viewModel.availablePages.isEmpty {
                                        Text(String(localized: "(No pages available)", table: "Settings"))
                                            .scaledFont(.body)
                                            .tag("")
                                    } else {
                                        ForEach(viewModel.availablePages) { page in
                                            Text(pageDisplayText(page))
                                                .scaledFont(.body)
                                                .tag(page.id)
                                        }
                                    }
                                } label: {
                                    EmptyView()
                                }
                                .disabled(viewModel.isBusy)
                                
                                Button {
                                    viewModel.loadAccessiblePagesIfNeeded(force: true)
                                } label: {
                                    if viewModel.isBusy {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    } else {
                                        Image(systemName: "arrow.clockwise")
                                            .scaledFont(.caption)
                                    }
                                }
                                .buttonStyle(.borderless)
                                .disabled(viewModel.isBusy)
                            }
                        } label: {
                            Text(String(localized: "Parent Page", table: "Settings"))
                                .scaledFont(.body)
                        }
                        
                        Button(String(localized: "Revoke Authorization", table: "Settings")) {
                            viewModel.revokeOAuth()
                        }
                        .scaledFont(.body)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.vertical, 4)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(localized: "Use OAuth to authorize SyncNos to access your Notion workspace. This is the recommended method.", table: "Settings"))
                            .scaledFont(.subheadline)
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
                                    .scaledFont(.headline)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isAuthorizing)
                    }
                    .padding(.vertical, 4)
                }

                if !viewModel.isOAuthAuthorized {

                    Divider()

                    Text(String(localized: "If you have any problems with OAuth, you can manually enter credentials:", table: "Settings"))
                        .scaledFont(.subheadline)
                        .foregroundColor(.secondary)

                    LabeledContent {
                        SecureField("NOTION_KEY", text: $viewModel.notionKeyInput)
                            .textFieldStyle(.roundedBorder)
                            .disabled(viewModel.isOAuthAuthorized)
                    } label: {
                        Text(String(localized: "NOTION_KEY", table: "Settings"))
                            .scaledFont(.body)
                    }

                    LabeledContent {
                        TextField("NOTION_PAGE_ID", text: $viewModel.notionPageIdInput)
                            .textFieldStyle(.roundedBorder)
                    } label: {
                        Text(String(localized: "NOTION_PAGE_ID", table: "Settings"))
                            .scaledFont(.body)
                    }

                    Button(String(localized: "Save", table: "Settings")) {
                        viewModel.saveCredentials()
                    }
                    .scaledFont(.body)
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isOAuthAuthorized)
                }
            }
            
            if let message = viewModel.message {
                Section {
                    Text(message)
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                        .lineLimit(nil)
                }
            }
            
            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage)
                        .scaledFont(.body)
                        .foregroundColor(.red)
                        .lineLimit(nil)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle(String(localized: "Notion API", table: "Settings"))
        .onAppear {
            if viewModel.isOAuthAuthorized {
                viewModel.loadAccessiblePagesIfNeeded()
            }
        }
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
            .applyFontScale()
    }
}

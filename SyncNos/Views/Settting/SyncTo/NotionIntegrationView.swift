import SwiftUI
import AppKit

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
            Section(header: Text("Authorization")) {
                if viewModel.isOAuthAuthorized {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("OAuth Authorized")
                                .scaledFont(.headline)
                        }
                        
                        if let workspaceName = viewModel.workspaceName {
                            Text("Workspace: \(workspaceName)")
                                .scaledFont(.subheadline)
                                .foregroundColor(.secondary)
                                .lineLimit(nil)
                        }
                        
                        // 当前父页面（用于在此页面下创建数据库）
                        LabeledContent("Parent Page") {
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
                                        Text("Loading...").tag("")
                                    } else if viewModel.availablePages.isEmpty {
                                        Text("(No pages available)").tag("")
                                    } else {
                                        ForEach(viewModel.availablePages) { page in
                                            Text(pageDisplayText(page))
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
                        }
                        
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
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isAuthorizing)
                    }
                    .padding(.vertical, 4)
                }

                if !viewModel.isOAuthAuthorized {

                    Divider()

                    Text("If you have any problems with OAuth, you can manually enter credentials:")
                        .scaledFont(.subheadline)
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

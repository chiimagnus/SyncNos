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
                                .font(.headline)
                        }
                        
                        if let workspaceName = viewModel.workspaceName {
                            Text("Workspace: \(workspaceName)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .lineLimit(nil)
                        }
                        
                        // 当前父页面（用于在此页面下创建数据库）
                        LabeledContent("Parent Page") {
                            HStack(spacing: 8) {
                                Picker(selection: Binding(
                                    get: {
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
                                        Text("Loading pages...").tag("")
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
                                .disabled(viewModel.isBusy || viewModel.availablePages.isEmpty)
                                
                                Button {
                                    viewModel.loadAccessiblePagesIfNeeded(force: true)
                                } label: {
                                    if viewModel.isBusy {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    } else {
                                        Image(systemName: "arrow.clockwise")
                                            .font(.caption)
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
                
            //     Divider()
                
            //     Text("Or manually enter credentials:")
            //         .font(.subheadline)
            //         .foregroundColor(.secondary)
                
            //     LabeledContent("NOTION_KEY") {
            //         SecureField("NOTION_KEY", text: $viewModel.notionKeyInput)
            //             .textFieldStyle(.roundedBorder)
            //             .disabled(viewModel.isOAuthAuthorized)
            //     }

            //     LabeledContent("NOTION_PAGE_ID") {
            //         TextField("NOTION_PAGE_ID", text: $viewModel.notionPageIdInput)
            //             .textFieldStyle(.roundedBorder)
            //     }

            //     Button("Save") {
            //         viewModel.saveCredentials()
            //     }
            //     .buttonStyle(.borderedProminent)
            //     .disabled(viewModel.isOAuthAuthorized)
            // }
            
            // Section(header: Text("Database IDs")) {
            //     // Optional per-source DB IDs
            //     LabeledContent("AppleBooks DB ID (optional)") {
            //         // Now read-only; moved to AppleBooksSettingsView
            //         Text(viewModel.appleBooksDbId.isEmpty ? "(moved to AppleBooks settings)" : viewModel.appleBooksDbId)
            //             .foregroundColor(.secondary)
            //     }

            //     LabeledContent("GoodLinks DB ID (optional)") {
            //         // Now read-only; moved to GoodLinksSettingsView
            //         Text(viewModel.goodLinksDbId.isEmpty ? "(moved to GoodLinks settings)" : viewModel.goodLinksDbId)
            //             .foregroundColor(.secondary)
            //     }
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
    }
}

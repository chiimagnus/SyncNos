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
    }
}

struct NotionIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        NotionIntegrationView()
    }
}

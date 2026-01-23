import SwiftUI

struct WeReadSettingsView: View {
    @StateObject private var viewModel: WeReadSettingsViewModel

    @MainActor
    init(viewModel: WeReadSettingsViewModel? = nil) {
        if let viewModel {
            _viewModel = StateObject(wrappedValue: viewModel)
        } else {
            _viewModel = StateObject(wrappedValue: WeReadSettingsViewModel())
        }
    }

    var body: some View {
        List {
            // MARK: - Account
            Section {
                LabeledContent {
                    Text(viewModel.isLoggedIn ? "Logged In" : "Not Logged In")
                        .scaledFont(.body)
                        .foregroundColor(viewModel.isLoggedIn ? .green : .secondary)
                } label: {
                    Label("Login Status", systemImage: viewModel.isLoggedIn ? "checkmark.seal.fill" : "xmark.seal")
                        .scaledFont(.body)
                }

                LabeledContent {
                    Button(role: .destructive) {
                        viewModel.clearLogin()
                    } label: {
                        Text("Log Out")
                            .scaledFont(.body)
                    }
                    .disabled(!viewModel.isLoggedIn)
                } label: {
                    Button {
                        viewModel.showLoginSheet = true
                    } label: {
                        Label("Open Login", systemImage: "safari")
                            .scaledFont(.body)
                    }
                }
            } header: {
                Text("Account")
                    .scaledFont(.headline)
            }
            
            // MARK: - Sync Settings
            Section {
                LabeledContent {
                    TextField("Notion Database ID for WeRead", text: $viewModel.weReadDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.weReadDbId) { _, _ in
                            viewModel.save()
                        }
                } label: {
                    Text("Database ID (optional)")
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text("Smart Auto Sync")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Sync every 5 minutes, only changed content")
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text("Sync Settings")
                    .scaledFont(.headline)
            }

        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("WeRead")
        .sheet(isPresented: $viewModel.showLoginSheet) {
            WeReadLoginView {
                viewModel.refreshLoginStatus()
                // 登录成功后发送通知，触发自动同步
                NotificationCenter.default.post(name: .weReadLoginSucceeded, object: nil)
            }
        }
    }
}

struct WeReadSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        WeReadSettingsView()
    }
}

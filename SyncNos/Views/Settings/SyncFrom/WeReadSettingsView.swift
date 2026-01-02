import SwiftUI

struct WeReadSettingsView: View {
    @StateObject private var viewModel = WeReadSettingsViewModel()

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text("Enable WeRead source")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Show WeRead in the main list and commands")
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text("Data Source")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
            
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
                    .foregroundStyle(.primary)
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
                    .foregroundStyle(.primary)
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
                if viewModel.isLoggedIn {
                    NotificationCenter.default.post(name: .weReadLoginSucceeded, object: nil)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToWeReadLogin).receive(on: DispatchQueue.main)) { _ in
            // 自动打开登录页面（当会话过期时）- 旧通知，保持兼容
            viewModel.showLoginSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("WeReadSettingsShowLoginSheet")).receive(on: DispatchQueue.main)) { _ in
            // 从 SettingsView 导航过来后，打开登录 Sheet
            viewModel.showLoginSheet = true
        }
    }
}

struct WeReadSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        WeReadSettingsView()
    }
}

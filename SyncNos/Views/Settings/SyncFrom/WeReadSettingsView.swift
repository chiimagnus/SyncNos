import SwiftUI

struct WeReadSettingsView: View {
    @StateObject private var viewModel = WeReadSettingsViewModel()

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text(String(localized: "Enable WeRead source", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Show WeRead in the main list and commands", table: "Settings"))
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text(String(localized: "Data Source", table: "Settings"))
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
                    Label(String(localized: "Login Status", table: "Settings"), systemImage: viewModel.isLoggedIn ? "checkmark.seal.fill" : "xmark.seal")
                        .scaledFont(.body)
                }

                LabeledContent {
                    Button(role: .destructive) {
                        viewModel.clearLogin()
                    } label: {
                        Text(String(localized: "Log Out", table: "Settings"))
                            .scaledFont(.body)
                    }
                    .disabled(!viewModel.isLoggedIn)
                } label: {
                    Button {
                        viewModel.showLoginSheet = true
                    } label: {
                        Label(String(localized: "Open Login", table: "Settings"), systemImage: "safari")
                            .scaledFont(.body)
                    }
                }
            } header: {
                Text(String(localized: "Account", table: "Settings"))
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
                    Text(String(localized: "Database ID (optional)", table: "Settings"))
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text(String(localized: "Smart Auto Sync", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Sync every 5 minutes, only changed content", table: "Settings"))
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text(String(localized: "Sync Settings", table: "Settings"))
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }

        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle(String(localized: "WeRead", table: "Common"))
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
        .onReceive(NotificationCenter.default.publisher(for: .weReadSettingsShowLoginSheet).receive(on: DispatchQueue.main)) { _ in
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

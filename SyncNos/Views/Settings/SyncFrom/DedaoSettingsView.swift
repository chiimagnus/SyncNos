import SwiftUI

struct DedaoSettingsView: View {
    @StateObject private var viewModel: DedaoSettingsViewModel
    
    init() {
        _viewModel = StateObject(wrappedValue: DedaoSettingsViewModel(
            authService: DIContainer.shared.dedaoAuthService
        ))
    }

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text("Enable Dedao source")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Show Dedao in the main list and commands")
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text("Data Source")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Account
            Section {
                HStack {
                    Label("Login Status", systemImage: viewModel.isLoggedIn ? "checkmark.seal.fill" : "xmark.seal")
                        .scaledFont(.body)
                    Spacer()
                    Text(viewModel.isLoggedIn ? "Logged In" : "Not Logged In")
                        .scaledFont(.body)
                        .foregroundColor(viewModel.isLoggedIn ? .green : .secondary)
                }

                HStack {
                    Button {
                        viewModel.showLoginSheet = true
                    } label: {
                        Label("Open Login WebView", systemImage: "safari")
                            .scaledFont(.body)
                    }

                    Spacer()

                    Button(role: .destructive) {
                        viewModel.clearLogin()
                    } label: {
                        Label("Log Out", systemImage: "rectangle.portrait.and.arrow.forward")
                            .scaledFont(.body)
                    }
                    .disabled(!viewModel.isLoggedIn)
                }
            } header: {
                Text("Account")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Sync Settings
            Section {
                LabeledContent {
                    TextField("Notion Database ID for Dedao", text: $viewModel.dedaoDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.dedaoDbId) { _, _ in
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
                    .font(.headline)
                    .foregroundStyle(.primary)
            }

        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Dedao")
        .sheet(isPresented: $viewModel.showLoginSheet) {
            DedaoLoginView(viewModel: DedaoLoginViewModel(
                authService: DIContainer.shared.dedaoAuthService,
                apiService: DIContainer.shared.dedaoAPIService
            )) {
                viewModel.refreshLoginStatus()
                // 登录成功后发送通知，触发自动同步
                if viewModel.isLoggedIn {
                    NotificationCenter.default.post(name: Notification.Name("DedaoLoginSucceeded"), object: nil)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToDedaoLogin")).receive(on: DispatchQueue.main)) { _ in
            // 自动打开登录页面（当会话过期时）
            viewModel.showLoginSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DedaoSettingsShowLoginSheet")).receive(on: DispatchQueue.main)) { _ in
            // 从 SettingsView 导航过来后，打开登录 Sheet
            viewModel.showLoginSheet = true
        }
    }
}

struct DedaoSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        DedaoSettingsView()
    }
}


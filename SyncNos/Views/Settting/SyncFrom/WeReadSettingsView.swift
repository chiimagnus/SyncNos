import SwiftUI

struct WeReadSettingsView: View {
    @StateObject private var viewModel = WeReadSettingsViewModel()

    var body: some View {
        List {
            Section(header: Label("WeRead Account", systemImage: "person.crop.square").scaledFont(.headline)) {
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
            }

            Section(header: Label("Notion Sync Setting", systemImage: "n.square").scaledFont(.headline)) {
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

                Toggle(isOn: $viewModel.autoSync) {
                    Text("Auto Sync (24 hours)")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Enable automatic sync for WeRead")
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                }
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
                    NotificationCenter.default.post(name: Notification.Name("WeReadLoginSucceeded"), object: nil)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToWeReadLogin")).receive(on: DispatchQueue.main)) { _ in
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

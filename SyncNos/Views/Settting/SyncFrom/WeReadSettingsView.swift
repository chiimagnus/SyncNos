import SwiftUI

struct WeReadSettingsView: View {
    @StateObject private var viewModel = WeReadSettingsViewModel()

    var body: some View {
        List {
            Section(header: Label("WeRead Account", systemImage: "person.crop.square")) {
                HStack {
                    Label("Login Status", systemImage: viewModel.isLoggedIn ? "checkmark.seal.fill" : "xmark.seal")
                    Spacer()
                    Text(viewModel.isLoggedIn ? "Logged In" : "Not Logged In")
                        .foregroundColor(viewModel.isLoggedIn ? .green : .secondary)
                }

                HStack {
                    Button {
                        viewModel.showLoginSheet = true
                    } label: {
                        Label("Open WeRead Login", systemImage: "safari")
                    }

                    Spacer()

                    Button(role: .destructive) {
                        viewModel.clearLogin()
                    } label: {
                        Label("Logout", systemImage: "rectangle.portrait.and.arrow.forward")
                    }
                    .disabled(!viewModel.isLoggedIn)
                }
            }

            Section(header: Label("Notion Sync Setting", systemImage: "n.square")) {
                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for WeRead", text: $viewModel.weReadDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.weReadDbId) { _, _ in
                            viewModel.save()
                        }
                }

                Toggle("Enable WeRead source", isOn: $viewModel.isSourceEnabled)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Show WeRead in the main list and commands")
                    .onChange(of: viewModel.isSourceEnabled) { _, _ in
                        viewModel.save()
                    }

                Toggle("Auto Sync (24 hours)", isOn: $viewModel.autoSync)
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

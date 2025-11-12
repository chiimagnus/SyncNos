import SwiftUI
import AppKit

struct SettingsView: View {
    @StateObject private var loginItemVM = LoginItemViewModel()
    @State private var navigationPath = NavigationPath()
    
    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section(header: Text("General")) {
                    LanguageView()

                    Toggle(isOn: $loginItemVM.isEnabled) {
                        Label("Launch at Login", systemImage: "arrow.up.right.square")
                    }
                    .toggleStyle(SwitchToggleStyle())
                    .onChange(of: loginItemVM.isEnabled) { newValue in
                        loginItemVM.setEnabled(newValue)
                    }

                    // 添加 AboutView 的 NavigationLink
                    NavigationLink(destination: AboutView()) {
                        HStack {
                            Label("About", systemImage: "info.circle")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .font(.body.weight(.regular))
                        }
                    }
                    .help("Show application about information")

                    // 添加 Apple 账号与登录 的 NavigationLink
                    NavigationLink(destination: AppleAccountView()) {
                        HStack {
                            Label("Apple Account", systemImage: "apple.logo")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .font(.body.weight(.regular))
                        }
                    }
                    .help("Manage Apple sign-in and account info")
                }
                .collapsible(false)

                Section(header: Text("Support")) {
                    NavigationLink(destination: IAPView()) {
                        HStack {
                            Label("Support & Pro Unlock", systemImage: "heart.circle")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .font(.body.weight(.regular))
                        }
                    }
                    .help("Support development and unlock Pro features")
                }
                .collapsible(false)

                Section(header: Text("Sync Data To")) {
                    NavigationLink(value: "notion") {
                        HStack {
                            Label("Notion API", systemImage: "n.square")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .font(.body.weight(.regular))
                        }
                    }
                    .help("Configure Notion and run example API calls")
                }
                .collapsible(false)

                Section(header: Text("Get Data From")) {
                    // Per-source auto sync toggles and navigation
                    NavigationLink(destination: AppleBooksSettingsView()) {
                        HStack {
                            Label("Apple Books", systemImage: "book")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }

                    NavigationLink(destination: GoodLinksSettingsView()) {
                        HStack {
                            Label("GoodLinks", systemImage: "bookmark")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("WeRead", systemImage: "")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Get", systemImage: "")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Dedao", systemImage: "")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Logseq", systemImage: "")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Obsidian", systemImage: "")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .collapsible(false)
            }
            .listStyle(SidebarListStyle())
            .scrollContentBackground(.hidden)
            .background(VisualEffectBackground(material: .windowBackground))
            .navigationDestination(for: String.self) { destination in
                if destination == "notion" {
                    NotionIntegrationView()
                }
            }
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem {
                Text("")
            }
        }
        .frame(width: 425)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToNotionSettings"))) { _ in
            navigationPath.append("notion")
        }
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

import SwiftUI
import AppKit

struct SettingsView: View {
    @StateObject private var loginItemVM = LoginItemViewModel()
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @State private var navigationPath = NavigationPath()
    
    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section(header: Text("General").scaledFont(.headline)) {
                    LanguageView()
                    
                    // 字体大小设置
                    NavigationLink(destination: TextSizeSettingsView()) {
                        HStack {
                            Label("Text Size", systemImage: "textformat.size")
                                .scaledFont(.body)
                            Spacer()
                            Text(FontScaleManager.shared.scaleLevel.shortName)
                                .scaledFont(.subheadline)
                                .foregroundColor(.secondary)
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help("Adjust text size throughout the app")

                    Toggle(isOn: Binding(
                        get: { loginItemVM.isEnabled },
                        set: { newValue in
                            // 只在用户手动操作toggle时才调用setEnabled
                            loginItemVM.setEnabled(newValue)
                        }
                    )) {
                        Label("Launch at Login", systemImage: "arrow.up.right.square")
                            .scaledFont(.body)
                    }
                    .toggleStyle(SwitchToggleStyle())

                    // 添加 AboutView 的 NavigationLink
                    NavigationLink(destination: AboutView()) {
                        HStack {
                            Label("About", systemImage: "info.circle")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help("Show application about information")
#if DEBUG
                    // 添加 Apple 账号与登录 的 NavigationLink
                    NavigationLink(destination: AppleAccountView()) {
                        HStack {
                            Label("Apple Account", systemImage: "apple.logo")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help("Manage Apple sign-in and account info")
#endif

                    NavigationLink(destination: IAPView()) {
                        HStack {
                            Label("Support", systemImage: "star")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help("Support development and unlock Pro features")
                }
                .collapsible(false)

                Section(header: Text("Sync Data To").scaledFont(.headline)) {
                    NavigationLink(value: "notion") {
                        HStack {
                            Label("Notion API", systemImage: "n.square")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help("Configure Notion and run example API calls")
                }
                .collapsible(false)

                Section(header: Text("Get Data From").scaledFont(.headline)) {
                    // Per-source auto sync toggles and navigation
                    NavigationLink(destination: AppleBooksSettingsView()) {
                        HStack {
                            Label("Apple Books", systemImage: "book")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: GoodLinksSettingsView()) {
                        HStack {
                            Label("GoodLinks", systemImage: "bookmark")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: WeReadSettingsView()) {
                        HStack {
                            Label("WeRead", systemImage: "text.book.closed")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: DedaoSettingsView()) {
                        HStack {
                            Label("Dedao", systemImage: "book.closed")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

#if DEBUG
                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Get", systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Logseq", systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }
                    
                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label("Obsidian", systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }
#endif
                }
                .collapsible(false)
            }
            .listStyle(SidebarListStyle())
            .scrollContentBackground(.hidden)
            .background(VisualEffectBackground(material: .windowBackground))
            .navigationDestination(for: String.self) { destination in
                switch destination {
                case "notion":
                    NotionIntegrationView()
                case "weread":
                    WeReadSettingsView()
                case "dedao":
                    DedaoSettingsView()
                default:
                    EmptyView()
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
        .onAppear {
            // 视图出现时刷新状态，监听系统设置中的变化
            loginItemVM.refreshStatus()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToNotionSettings"))) { _ in
            navigationPath.append("notion")
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToWeReadLogin"))) { _ in
            // 先导航到 WeReadSettingsView，然后它会自动打开登录 Sheet
            navigationPath.append("weread")
            // 延迟发送通知，等待 WeReadSettingsView 加载完成
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: Notification.Name("WeReadSettingsShowLoginSheet"), object: nil)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToDedaoLogin"))) { _ in
            // 先导航到 DedaoSettingsView，然后它会自动打开登录 Sheet
            navigationPath.append("dedao")
            // 延迟发送通知，等待 DedaoSettingsView 加载完成
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: Notification.Name("DedaoSettingsShowLoginSheet"), object: nil)
            }
        }
        // 应用字体缩放到整个视图层级
        .applyFontScale()
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

import SwiftUI

struct SettingsView: View {
    @StateObject private var loginItemVM = LoginItemViewModel()
    @StateObject private var appIconDisplayVM = AppIconDisplayViewModel()
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @State private var navigationPath = NavigationPath()
    
    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section {
                    LanguageView()
                    
                    // 字体大小设置
                    NavigationLink(destination: TextSizeSettingsView()) {
                        HStack {
                            Label(String(localized: "Text Size", table: "Settings"), systemImage: "textformat.size")
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
                    .help(String(localized: "Adjust text size throughout the app", table: "Settings"))

                    Toggle(isOn: Binding(
                        get: { loginItemVM.isEnabled },
                        set: { newValue in
                            // 只在用户手动操作toggle时才调用setEnabled
                            loginItemVM.setEnabled(newValue)
                        }
                    )) {
                        Label(String(localized: "Launch at Login", table: "Settings"), systemImage: "arrow.up.right.square")
                            .scaledFont(.body)
                    }
                    .toggleStyle(SwitchToggleStyle())
                    
                    // 图标显示模式选择
                    Picker(selection: $appIconDisplayVM.selectedMode) {
                        ForEach(AppIconDisplayMode.allCases) { mode in
                            Text(mode.displayName)
                                .tag(mode)
                        }
                    } label: {
                        Label(String(localized: "Display SyncNos icon", table: "Settings"), systemImage: "square.grid.2x2")
                            .scaledFont(.body)
                    }
                    .pickerStyle(.menu)

                    // 添加 AboutView 的 NavigationLink
                    NavigationLink(destination: AboutView()) {
                        HStack {
                            Label(String(localized: "About", table: "Settings"), systemImage: "info.circle")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help(String(localized: "Show application about information", table: "Settings"))
#if DEBUG
                    // 添加 Apple 账号与登录 的 NavigationLink
                    NavigationLink(destination: AppleAccountView()) {
                        HStack {
                            Label(String(localized: "Apple Account", table: "Settings"), systemImage: "apple.logo")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help(String(localized: "Manage Apple sign-in and account info", table: "Settings"))
#endif

                    NavigationLink(destination: IAPView()) {
                        HStack {
                            Label(String(localized: "Support", table: "Common"), systemImage: "star")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help(String(localized: "Support development and unlock Pro features", table: "Settings"))
                } header: {
                    Text(String(localized: "General", table: "Settings"))
                        .scaledFont(.headline)
                        .foregroundStyle(.primary)
                }
                .collapsible(false)

                Section {
                    NavigationLink(value: "notion") {
                        HStack {
                            Label(String(localized: "Notion", table: "Settings"), systemImage: "n.square")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.body)
                        }
                    }
                    .help(String(localized: "Configure Notion and run example API calls", table: "Settings"))
                } header: {
                    Text(String(localized: "Sync Data To", table: "Settings"))
                        .scaledFont(.headline)
                        .foregroundStyle(.primary)
                }
                .collapsible(false)

                Section {
                    // Per-source auto sync toggles and navigation
                    NavigationLink(destination: AppleBooksSettingsView()) {
                        HStack {
                            Label(String(localized: "Apple Books", table: "Common"), systemImage: "book")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: GoodLinksSettingsView()) {
                        HStack {
                            Label(String(localized: "GoodLinks", table: "Common"), systemImage: "bookmark")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: WeReadSettingsView()) {
                        HStack {
                            Label(String(localized: "WeRead", table: "Common"), systemImage: "w.square")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: DedaoSettingsView()) {
                        HStack {
                            Label(String(localized: "Dedao", table: "Common"), systemImage: "d.square")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }
                    
                    NavigationLink(destination: OCRSettingsView()) {
                        HStack {
                            Label(String(localized: "Chats", table: "Settings"), systemImage: "message")
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
                            Label(String(localized: "Get", table: "Settings"), systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }

                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label(String(localized: "Logseq", table: "Settings"), systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }
                    
                    NavigationLink(destination: EmptyView()) {
                        HStack {
                            Label(String(localized: "Obsidian", table: "Settings"), systemImage: "")
                                .scaledFont(.body)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .scaledFont(.caption)
                        }
                    }
#endif
                } header: {
                    Text(String(localized: "Get Data From", table: "Settings"))
                        .scaledFont(.headline)
                        .foregroundStyle(.primary)
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
        .navigationTitle(String(localized: "Settings", table: "Settings"))
        .toolbar {
            ToolbarItem {
                Text(String(localized: "", table: "Settings"))
            }
        }
        .frame(width: 425)
        .onAppear {
            // 视图出现时刷新状态，监听系统设置中的变化
            loginItemVM.refreshStatus()
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToNotionSettings)) { _ in
            navigationPath.append("notion")
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToWeReadLogin)) { _ in
            // 先导航到 WeReadSettingsView，然后它会自动打开登录 Sheet
            navigationPath.append("weread")
            // 延迟发送通知，等待 WeReadSettingsView 加载完成
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: .weReadSettingsShowLoginSheet, object: nil)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToDedaoLogin)) { _ in
            // 先导航到 DedaoSettingsView，然后它会自动打开登录 Sheet
            navigationPath.append("dedao")
            // 延迟发送通知，等待 DedaoSettingsView 加载完成
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: .dedaoSettingsShowLoginSheet, object: nil)
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

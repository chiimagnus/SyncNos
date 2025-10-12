import SwiftUI
import AppKit

struct SettingsView: View {
    @State private var selectedLanguage: String = {
        let currentLocale = Locale.current
        let languageCode = currentLocale.language.languageCode?.identifier

        // 处理特殊语言情况
        if languageCode?.starts(with: "zh") == true {
            return "zh-Hans"
        }

        // 处理法语变体（加拿大法语等）
        if languageCode?.starts(with: "fr") == true {
            return "fr"
        }

        // 处理德语变体（奥地利德语等）
        if languageCode?.starts(with: "de") == true {
            return "de"
        }

        // 处理葡萄牙语变体（巴西葡萄牙语）
        if languageCode == "pt" {
            return "pt-BR"
        }

        // 检查是否支持当前语言，否则默认使用英语
        let supportedCodes = ["en", "zh-Hans", "ja", "ko", "es-ES", "fr", "de", "pt-BR", "ru"]
        return supportedCodes.contains(languageCode ?? "") ? languageCode! : "en"
    }()

    let supportedLanguages = [
        ("en", "English"),
        ("zh-Hans", "中文(简体)"),
        ("ja", "日本語"),
        ("ko", "한국어"),
        ("es-ES", "Español"),
        ("fr", "Français"),
        ("de", "Deutsch"),
        ("pt-BR", "Português (Brasil)"),
        ("ru", "Русский")
    ]

    private func changeAppLanguage(to languageCode: String) {
        // 保存用户选择的语言偏好
        UserDefaults.standard.set([languageCode], forKey: "AppleLanguages")
        UserDefaults.standard.synchronize()

        // 显示重启提示
        let alert = NSAlert()
        alert.messageText = NSLocalizedString("Language Changed", comment: "Language change confirmation title")
        alert.informativeText = NSLocalizedString("Please restart the application for the language change to take effect.", comment: "Language change restart instruction")
        alert.alertStyle = .informational
        alert.addButton(withTitle: NSLocalizedString("OK", comment: "OK button"))
        alert.runModal()
    }

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("General")) {
                    Picker("Language", selection: $selectedLanguage) {
                        ForEach(supportedLanguages, id: \.0) { language in
                            Text(language.1).tag(language.0)
                        }
                    }
                    .onChange(of: selectedLanguage) { newLanguage in
                        changeAppLanguage(to: newLanguage)
                    }
                    .help("Change application language")

                    // 添加 AboutView 的 NavigationLink
                    NavigationLink(destination: AboutView()) {
                        HStack {
                            Text("About")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                                .font(.body.weight(.regular))
                        }
                    }
                    .help("Show application about information")
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

                Section(header: Text("Integrations")) {
                    NavigationLink(destination: NotionIntegrationView()) {
                            HStack {
                                Label("Notion API", systemImage: "n.square")
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.secondary)
                                    .font(.body.weight(.regular))
                            }
                        }
                        .help("Configure Notion and run example API calls")

                    Divider()

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

                }
                .collapsible(false)
            }
            .listStyle(SidebarListStyle())
            .scrollContentBackground(.hidden)
            .background(VisualEffectBackground(material: .windowBackground))
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem {
                Text("")
            }
        }
        .frame(minWidth: 400, idealWidth: 425, maxWidth: 425)
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

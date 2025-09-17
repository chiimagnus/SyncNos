import SwiftUI
import AppKit

struct SettingsView: View {
    @State private var isLoading: Bool = false
    @State private var selectedLanguage: String = {
        let currentLocale = Locale.current
        let languageCode = currentLocale.language.languageCode?.identifier

        // 处理中文特殊情况
        if languageCode?.starts(with: "zh") == true {
            return "zh-Hans"
        }

        // 检查是否支持当前语言，否则默认使用英语
        let supportedCodes = ["en", "zh-Hans", "ja", "ko"]
        return supportedCodes.contains(languageCode ?? "") ? languageCode! : "en"
    }()

    let supportedLanguages = [
        ("en", "English"),
        ("zh-Hans", "中文(简体)"),
        ("ja", "日本語"),
        ("ko", "한국어")
    ]

    private func changeAppLanguage(to languageCode: String) {
        // 保存用户选择的语言偏好
        UserDefaults.standard.set([languageCode], forKey: "AppleLanguages")
        UserDefaults.standard.synchronize()

        // 显示重启提示
        let alert = NSAlert()
        alert.messageText = "Language Changed"
        alert.informativeText = "Please restart the application for the language change to take effect."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("General")) {
                    Button(action: AppleBooksPicker.pickAppleBooksContainer) {
                        Label("Open Apple Books notes", systemImage: "book")
                    }
                    .help("Choose Apple Books container directory and load notes")

                    Picker("Language", selection: $selectedLanguage) {
                        ForEach(supportedLanguages, id: \.0) { language in
                            Text(language.1).tag(language.0)
                        }
                    }
                    .onChange(of: selectedLanguage) { newLanguage in
                        changeAppLanguage(to: newLanguage)
                    }
                    .help("Change application language")
                }
                .collapsible(false)

                Section(header: Text("Integrations")) {
                    NavigationLink(destination: NotionIntegrationView()) {
                        Label("Notion Integration", systemImage: "n.square")
                    }
                    .help("Configure Notion and run example API calls")
                }
                .collapsible(false)
            }
            .listStyle(SidebarListStyle())
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem {
                Text("")
            }
        }
        .frame(minWidth: 320, idealWidth: 375, maxWidth: 375)
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

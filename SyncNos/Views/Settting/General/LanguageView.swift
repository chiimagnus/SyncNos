import SwiftUI

struct LanguageView: View {
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
        let supportedCodes = ["en", "zh-Hans", "da", "nl", "fi", "fr", "de", "id", "ja", "ko", "es-ES", "pt-BR", "ru", "sv", "th", "vi"]
        return supportedCodes.contains(languageCode ?? "") ? languageCode! : "en"
    }()

    @State private var showRestartAlert = false

    let supportedLanguages = [
        ("da", "Dansk"),
        ("de", "Deutsch"),
        ("en", "English"),
        ("es-ES", "Español"),
        ("fi", "Suomi"),
        ("fr", "Français"),
        ("id", "Bahasa Indonesia"),
        ("ja", "日本語"),
        ("ko", "한국어"),
        ("nl", "Nederlands"),
        ("pt-BR", "Português (Brasil)"),
        ("ru", "Русский"),
        ("sv", "Svenska"),
        ("th", "ไทย"),
        ("vi", "Tiếng Việt"),
        ("zh-Hans", "中文(简体)")
    ]

    private func changeAppLanguage(to languageCode: String) {
        // 保存用户选择的语言偏好
        UserDefaults.standard.set([languageCode], forKey: "AppleLanguages")
        UserDefaults.standard.synchronize()

        // 显示重启提示
        showRestartAlert = true
    }

    private func restartApplication() {
        // 若正在同步，先弹出统一的退出确认
        if DIContainer.shared.syncActivityMonitor.isSyncing {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = NSLocalizedString("Sync to Notion is in progress. Quit anyway?", comment: "")
            alert.addButton(withTitle: NSLocalizedString("Don't Quit", comment: "")) // 默认：不退出
            alert.addButton(withTitle: NSLocalizedString("Quit", comment: ""))
            let response = alert.runModal()
            guard response == .alertSecondButtonReturn else { return }
            // 避免接下来 NSApp.terminate(nil) 再次弹窗
            NotificationCenter.default.post(name: Notification.Name("BypassQuitConfirmationOnce"), object: nil)
        }

        // 使用 open -n 启动新实例
        let task = Process()
        task.launchPath = "/usr/bin/open"
        task.arguments = ["-n", Bundle.main.bundlePath]
        task.launch()

        // 延迟退出当前应用，让新实例有时间启动
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApplication.shared.terminate(nil)
        }
    }

    var body: some View {
        Picker(selection: $selectedLanguage) {
            ForEach(supportedLanguages, id: \.0) { language in
                Text(language.1).tag(language.0)
            }
        } label: {
            Label("Language", systemImage: "globe")
        }
        .onChange(of: selectedLanguage) { _, newLanguage in
            changeAppLanguage(to: newLanguage)
        }
        .help("Change application language")
        .alert("Language Changed", isPresented: $showRestartAlert) {
            Button("OK") {
                // 仅关闭提示
            }
            Button("Restart") {
                restartApplication()
            }
        } message: {
            Text("Please restart the application for the language change to take effect.")
        }
    }
}

struct LanguageView_Previews: PreviewProvider {
    static var previews: some View {
        LanguageView()
    }
}

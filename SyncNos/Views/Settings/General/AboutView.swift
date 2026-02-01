import SwiftUI

struct AboutView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @Environment(\.fontScale) private var fontScale
    
    private var iconSize: CGFloat { 128 * fontScale }
    
    var body: some View {
        Group {
            if fontScaleManager.isAccessibilitySize {
                ScrollView {
                    content
                        .padding(32)
                }
            } else {
                content
                    .padding(32)
            }
        }
        .navigationTitle("About")
    }
    
    private var content: some View {
        VStack(alignment: .leading, spacing: 28) {
            appSection
            authorSection
            Spacer()
        }
    }

    // MARK: - App Section

    private var appSection: some View {
        Group {
            if fontScaleManager.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 16) {
                    appIconView
                    appInfoView
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    appIconView
                    appInfoView
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var appIconView: some View {
        // Image(nsImage: NSApp.applicationIconImage)
        Image("SyncNosLogo")
            .resizable()
            .scaledToFill()
            .frame(width: iconSize, height: iconSize)
    }

    private var appInfoView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appName)
                .scaledFont(.largeTitle, weight: .bold)

            Text("Version \(Bundle.main.appVersion) (\(Bundle.main.appBuild))")
                .scaledFont(.subheadline)
                .foregroundStyle(.secondary)

            Divider()
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 8) {
                // AboutLinkButton(symbol: "heart.fill", title: "Rate & Review", action: openAppStoreReview)
                // AboutLinkButton(symbol: "ladybug.fill", title: "Report Issues", action: openGitHubIssues)
                AboutLinkButton(symbol: "chevron.left.forwardslash.chevron.right", title: "Source Code", action: openGitHubRepo)
                AboutLinkButton(symbol: "doc.text.fill", title: "Privacy Policy", action: openPrivacyPolicy)
                AboutLinkButton(symbol: "clock.arrow.circlepath", title: "Changelog", action: openChangelog)
            }
        }
    }

    // MARK: - Author Section

    private var authorSection: some View {
        Group {
            if fontScaleManager.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 16) {
                    authorAvatarView
                    authorInfoView
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    authorAvatarView
                    authorInfoView
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var authorAvatarView: some View {
        Image("AuthorAvatar")
            .resizable()
            .scaledToFill()
            .frame(width: iconSize, height: iconSize)
            .clipShape(Circle())
    }

    private var authorInfoView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼")
                .scaledFont(.largeTitle, weight: .bold)

            Divider()
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 8) {
                AboutLinkButton(symbol: "envelope.fill", title: "Mail", action: openFeedbackMail)
                AboutLinkButton(symbol: "person.crop.circle", title: "GitHub", action: openAuthorGitHubProfile)
            }
        }
    }

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "SyncNos"
    }
}

// MARK: - About Link Button

private struct AboutLinkButton: View {
    let symbol: String
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 16)
                Text(title)
                    .scaledFont(.callout)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.link)
    }
}

// MARK: - Helpers

private func openAppStoreReview() {
    let appStoreID = "6752426176"
    let appStoreURL = URL(string: "macappstore://apps.apple.com/app/id\(appStoreID)")!
    let webURL = URL(string: "https://apps.apple.com/app/id\(appStoreID)")!
    if !NSWorkspace.shared.open(appStoreURL) {
        NSWorkspace.shared.open(webURL)
    }
}

private func openGitHubIssues() {
    let url = URL(string: "https://github.com/chiimagnus/SyncNos/issues")!
    NSWorkspace.shared.open(url)
}

private func openGitHubRepo() {
    let url = URL(string: "https://github.com/chiimagnus/SyncNos")!
    NSWorkspace.shared.open(url)
}

private func openPrivacyPolicy() {
    // 打开仓库内的隐私政策文件（在 Finder/默认编辑器中）
    if let url = Bundle.main.url(forResource: "PRIVACY_POLICY", withExtension: "md", subdirectory: "Resource") {
        NSWorkspace.shared.open(url)
    } else if let web = URL(string: "https://chiimagnus.notion.site/privacypolicyandtermsofuse") {
        NSWorkspace.shared.open(web)
    }
}

private func openChangelog() {
    let url = URL(string: "https://chiimagnus.notion.site/syncnos-changelog")!
    NSWorkspace.shared.open(url)
}

private func openAuthorGitHubProfile() {
    let url = URL(string: "https://github.com/chiimagnus")!
    NSWorkspace.shared.open(url)
}

private func openFeedbackMail() {
    NSWorkspace.shared.open(makeFeedbackMailtoURL())
}

private func makeFeedbackMailtoURL() -> URL {
    var components = URLComponents()
    components.scheme = "mailto"
    components.path = "chii_magnus@outlook.com"

    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
    let os = ProcessInfo.processInfo.operatingSystemVersionString

    let versionLine: String = {
        if !version.isEmpty && !build.isEmpty { return "\(version) (\(build))" }
        if !version.isEmpty { return version }
        if !build.isEmpty { return build }
        return "unknown"
    }()

    components.queryItems = [
        URLQueryItem(name: "subject", value: "[SyncNos] Feedback"),
        URLQueryItem(
            name: "body",
            value: """
App: SyncNos
Version: \(versionLine)
macOS: \(os)

Message:

"""
        )
    ]

    return components.url ?? URL(string: "mailto:chii_magnus@outlook.com")!
}

private extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }
    var appBuild: String {
        infoDictionary?["CFBundleVersion"] as? String ?? ""
    }
}

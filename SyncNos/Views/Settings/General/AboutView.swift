import SwiftUI

struct AboutView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @Environment(\.fontScale) private var fontScale
    
    private var iconSize: CGFloat { 128 * fontScale }
    
    var body: some View {
        Group {
            if fontScaleManager.isAccessibilitySize {
                // 辅助功能大小时使用垂直布局
                ScrollView {
                    VStack(spacing: 24) {
                        aboutContent
                    }
                    .padding(32)
                }
            } else {
                // 标准大小时使用水平布局
                HStack(alignment: .top, spacing: 24) {
                    aboutContent
                }
                .padding(32)
            }
        }
        .frame(minWidth: 450, minHeight: 320)
        .navigationTitle("About")
    }
    
    @ViewBuilder
    private var aboutContent: some View {
        // App Icon
        Image(nsImage: NSApp.applicationIconImage)
            .resizable()
            .frame(width: iconSize, height: iconSize)
            .cornerRadius(24)
            .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
        
        // 信息区域
        VStack(alignment: .leading, spacing: 12) {
            // App 名称
            Text(appName)
                .scaledFont(.largeTitle, weight: .bold)
            
            // 版本信息
            Text("Version \(Bundle.main.appVersion) (\(Bundle.main.appBuild))")
                .scaledFont(.subheadline)
                .foregroundStyle(.secondary)
            
            Divider()
                .padding(.vertical, 4)
            
            // 操作链接
            VStack(alignment: .leading, spacing: 8) {
                AboutLinkButton(symbol: "heart.fill", title: "Rate & Review", action: openAppStoreReview)
                AboutLinkButton(symbol: "ladybug.fill", title: "Report Issues", action: openGitHubIssues)
                AboutLinkButton(symbol: "chevron.left.forwardslash.chevron.right", title: "Source Code", action: openGitHubRepo)
                AboutLinkButton(symbol: "doc.text.fill", title: "Privacy Policy", action: openPrivacyPolicy)
                AboutLinkButton(symbol: "clock.arrow.circlepath", title: "Changelog", action: openChangelog)
            }
            
            Spacer()
            
            // 底部信息
            Text("Made with SwiftUI • macOS 14+")
                .scaledFont(.footnote)
                .foregroundStyle(.tertiary)
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

private extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }
    var appBuild: String {
        infoDictionary?["CFBundleVersion"] as? String ?? ""
    }
}

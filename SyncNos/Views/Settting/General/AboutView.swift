import SwiftUI
import AppKit

struct AboutView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 84, height: 84)
                .cornerRadius(18)
                .shadow(radius: 6)

            VStack(spacing: 4) {
                Text(appName)
                    .font(.title2).bold()
                Text("Version \(Bundle.main.appVersion) (\(Bundle.main.appBuild))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // 小组件：一组常用动作
            HStack(spacing: 12) {
                ActionCard(symbol: "heart", title: "Rate & Review") {
                    openAppStoreReview()
                }
                ActionCard(symbol: "ladybug", title: "Report Issues") {
                    openGitHubIssues()
                }
                ActionCard(symbol: "link", title: "Source Code") {
                    openGitHubRepo()
                }
                ActionCard(symbol: "doc.plaintext", title: "Privacy Policy") {
                    openPrivacyPolicy()
                }
            }
            .padding(.top, 8)

            Text("Made with SwiftUI ⋅ macOS 14+")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
        .padding(20)
        .frame(width: 425, height: 400)
        .navigationTitle("About")
    }

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "SyncNos"
    }
}

private struct ActionCard: View {
    let symbol: String
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(.ultraThickMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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

private extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }
    var appBuild: String {
        infoDictionary?["CFBundleVersion"] as? String ?? ""
    }
}

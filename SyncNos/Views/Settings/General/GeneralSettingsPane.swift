import AppKit
import SwiftUI

struct GeneralSettingsPane: View {
    @ObservedObject var loginItemVM: LoginItemViewModel
    @ObservedObject var appIconDisplayVM: AppIconDisplayViewModel

    var body: some View {
        List {
            LanguageView()

            Button(action: openSystemProxySettings) {
                HStack {
                    Label("Proxy", systemImage: "network")
                        .scaledFont(.body)
                    Spacer()
                    Text("System")
                        .scaledFont(.subheadline)
                        .foregroundColor(.secondary)
                    Image(systemName: "chevron.right")
                        .foregroundColor(.secondary)
                        .scaledFont(.body)
                }
            }
            .buttonStyle(.plain)
            .help("SyncNos follows macOS system proxy settings for web requests")

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
                    // 只在用户手动操作 toggle 时才调用 setEnabled
                    loginItemVM.setEnabled(newValue)
                }
            )) {
                Label("Launch at Login", systemImage: "arrow.up.right.square")
                    .scaledFont(.body)
            }
            .toggleStyle(.switch)

            // 图标显示模式选择
            Picker(selection: $appIconDisplayVM.selectedMode) {
                ForEach(AppIconDisplayMode.allCases) { mode in
                    Text(mode.displayName)
                        .tag(mode)
                }
            } label: {
                Label("Display SyncNos icon", systemImage: "square.grid.2x2")
                    .scaledFont(.body)
            }
            .pickerStyle(.menu)

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
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("General")
    }

    // MARK: - Actions

    private func openSystemProxySettings() {
        let candidates = [
            "x-apple.systempreferences:com.apple.Network-Settings.extension?Proxies",
            "x-apple.systempreferences:com.apple.NetworkSettings-Settings.extension?Proxies",
            "x-apple.systempreferences:com.apple.preference.network?Proxies",
            "x-apple.systempreferences:com.apple.Network-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.network"
        ]

        for raw in candidates {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) {
                return
            }
        }
    }
}

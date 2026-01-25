import SwiftUI

struct GeneralSettingsPane: View {
    @ObservedObject var loginItemVM: LoginItemViewModel
    @ObservedObject var appIconDisplayVM: AppIconDisplayViewModel

    var body: some View {
        List {
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
}

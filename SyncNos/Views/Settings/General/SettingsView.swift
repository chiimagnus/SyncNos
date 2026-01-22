import SwiftUI

struct SettingsView: View {
    // MARK: - Navigation

    private enum Pane: Hashable {
        case general
        case dataSources
        case notion
        case dataSource(ContentSource)
    }

    @StateObject private var loginItemVM = LoginItemViewModel()
    @StateObject private var appIconDisplayVM = AppIconDisplayViewModel()
    @StateObject private var defaultsObserver = UserDefaultsObserver()

    @State private var selection: Pane? = .general

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    // MARK: - General
                    sidebarRow(title: "General", systemImage: "gear", tag: .general)

                    // MARK: - Data Sources
                    sidebarRow(title: "Data Sources", systemImage: "square.stack.3d.up", tag: .dataSources)
                }
                .collapsible(false)

                // MARK: - Data Source Settings
                if hasAnyEnabledDataSource {
                    Section {
                        ForEach(enabledProviders, id: \.source) { provider in
                            sidebarRow(
                                title: provider.displayName,
                                systemImage: provider.iconName,
                                tag: .dataSource(provider.source)
                            )
                        }
                    }
                    .collapsible(false)
                }

                // MARK: - Sync Data To
                Section {
                    sidebarRow(title: "Notion", systemImage: "n.square", tag: .notion)
                }
                .collapsible(false)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        detail: {
            NavigationStack {
                detailView(for: selection ?? .general)
            }
        }
        .frame(minWidth: 600, minHeight: 560)
        .onAppear {
            // 视图出现时刷新状态，监听系统设置中的变化
            loginItemVM.refreshStatus()
            normalizeSelectionIfNeeded()
        }
        .onChange(of: defaultsObserver.changeCounter) { _, _ in
            normalizeSelectionIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToNotionSettings).receive(on: DispatchQueue.main)) { _ in
            selection = .notion
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToWeReadLogin).receive(on: DispatchQueue.main)) { _ in
            selection = .dataSource(.weRead)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: .weReadSettingsShowLoginSheet, object: nil)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToDedaoLogin).receive(on: DispatchQueue.main)) { _ in
            selection = .dataSource(.dedao)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                NotificationCenter.default.post(name: .dedaoSettingsShowLoginSheet, object: nil)
            }
        }
        // 应用字体缩放到整个视图层级
        .applyFontScale()
    }

    // MARK: - Sidebar

    private var hasAnyEnabledDataSource: Bool {
        !enabledProviders.isEmpty
    }

    private var enabledProviders: [any DataSourceUIProvider] {
        DataSourceRegistry.shared.allProviders.filter { isSourceEnabled($0) }
    }

    @ViewBuilder
    private func sidebarRow(title: String, systemImage: String, tag: Pane) -> some View {
        Label(title, systemImage: systemImage)
            .scaledFont(.body)
            .tag(tag)
    }

    // MARK: - Detail

    @ViewBuilder
    private func detailView(for pane: Pane) -> some View {
        switch pane {
        case .general:
            GeneralSettingsPane(loginItemVM: loginItemVM, appIconDisplayVM: appIconDisplayVM)
        case .dataSources:
            DataSourcesOverviewView(defaultsObserver: defaultsObserver)
        case .notion:
            NotionIntegrationView()
        case .dataSource(let source):
            DataSourceRegistry.shared.provider(for: source).makeSettingsView()
        }
    }

    // MARK: - Selection Normalization

    private func normalizeSelectionIfNeeded() {
        guard let selection else { return }
        switch selection {
        case .dataSource(let source) where !isSourceEnabled(DataSourceRegistry.shared.provider(for: source)):
            self.selection = .dataSources
        default:
            break
        }
    }

    // MARK: - Enabled State

    private func isSourceEnabled(_ provider: any DataSourceUIProvider) -> Bool {
        (UserDefaults.standard.object(forKey: provider.enabledStorageKey) as? Bool) ?? provider.defaultEnabled
    }
}

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
    }
}

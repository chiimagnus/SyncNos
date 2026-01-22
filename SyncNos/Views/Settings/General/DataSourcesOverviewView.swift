import SwiftUI

/// 数据源开关总览
/// 用于集中管理各数据源的启用状态
struct DataSourcesOverviewView: View {
    @ObservedObject var defaultsObserver: UserDefaultsObserver

    var body: some View {
        List {
            // MARK: - Data Sources
            Section {
                ForEach(DataSourceRegistry.shared.allProviders, id: \.source) { provider in
                    Toggle(isOn: enabledBinding(for: provider)) {
                        Label(provider.displayName, systemImage: provider.iconName)
                            .scaledFont(.body)
                    }
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Show \(provider.displayName) in the main list and Settings sidebar")
                }
            } header: {
                Text("Data Sources")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            } footer: {
                Text("Enabled data sources will appear in the Settings sidebar.")
                    .scaledFont(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Data Sources")
    }

    // MARK: - Enabled Bindings

    private func isSourceEnabled(_ provider: any DataSourceUIProvider) -> Bool {
        (UserDefaults.standard.object(forKey: provider.enabledStorageKey) as? Bool) ?? provider.defaultEnabled
    }

    private func setSourceEnabled(_ provider: any DataSourceUIProvider, _ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: provider.enabledStorageKey)
        defaultsObserver.forceRefresh()
    }

    private func enabledBinding(for provider: any DataSourceUIProvider) -> Binding<Bool> {
        Binding(
            get: { isSourceEnabled(provider) },
            set: { newValue in setSourceEnabled(provider, newValue) }
        )
    }
}

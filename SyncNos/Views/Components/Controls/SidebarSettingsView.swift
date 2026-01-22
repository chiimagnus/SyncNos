import SwiftUI

// MARK: - Sidebar Settings Menu

/// 侧边栏 Settings 菜单：Data Sources / Settings
struct SidebarSettingsView: View {
    @Binding var isPresented: Bool
    @State private var selectedItem: SidebarSettingsMenuItem = .dataSourcesItem

    private var menuItems: [SidebarSettingsMenuItem] {
        var items: [SidebarSettingsMenuItem] = [.dataSourcesItem]
        items.append(contentsOf: ContentSource.customOrder.map { SidebarSettingsMenuItem.sourceItem($0) })
        items.append(.notionItem)
        return items
    }

    var body: some View {
        HStack(spacing: 0) {
            menuColumn
            Divider()
            contentColumn
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
    }

    // MARK: - Left Column

    private var menuColumn: some View {
        VStack(spacing: 10) {
            Text("Settings")
                .scaledFont(.headline, weight: .semibold)
                .foregroundStyle(.primary)

            ForEach(menuItems) { item in
                SidebarSettingsMenuButton(
                    item: item,
                    isActive: selectedItem == item
                ) {
                    selectedItem = item
                }
            }

            Spacer()

            Button {
                closeMenu()
            } label: {
                Label("Back", systemImage: "arrow.backward")
                    .scaledFont(.body, weight: .medium)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.primary.opacity(0.04))
    }

    // MARK: - Right Column

    @ViewBuilder
    private var contentColumn: some View {
        switch selectedItem.kind {
        case .dataSources:
            SidebarSettingsDataSourcesTab()
        case .source(let source):
            SidebarSettingsDataSourceSettingsTab(
                source: source,
                isEnabled: enabledBinding(for: source)
            )
        case .notion:
            NotionIntegrationView()
        }
    }

    private func enabledBinding(for source: ContentSource) -> Binding<Bool> {
        let provider = source.uiProvider
        return Binding(
            get: {
                (UserDefaults.standard.object(forKey: provider.enabledStorageKey) as? Bool)
                    ?? provider.defaultEnabled
            },
            set: { newValue in
                UserDefaults.standard.set(newValue, forKey: provider.enabledStorageKey)
            }
        )
    }

    // MARK: - Actions

    private func closeMenu() {
        withAnimation(.easeInOut(duration: 0.2)) {
            isPresented = false
        }
    }
}

// MARK: - Menu Item

private struct SidebarSettingsMenuItem: Identifiable, Hashable {
    enum Kind: Hashable {
        case dataSources
        case source(ContentSource)
        case notion
    }

    let kind: Kind

    var id: String {
        switch kind {
        case .dataSources:
            return "dataSources"
        case .source(let source):
            return source.rawValue
        case .notion:
            return "notion"
        }
    }

    var title: LocalizedStringKey {
        switch kind {
        case .dataSources:
            return "Data Sources"
        case .source(let source):
            return LocalizedStringKey(source.displayName)
        case .notion:
            return "Notion"
        }
    }

    var icon: String {
        switch kind {
        case .dataSources:
            return "square.grid.2x2"
        case .source(let source):
            return source.icon
        case .notion:
            return "n.square"
        }
    }

    var accentColor: Color {
        switch kind {
        case .source(let source):
            return source.accentColor
        case .dataSources, .notion:
            return Color.accentColor
        }
    }

    static let dataSourcesItem = SidebarSettingsMenuItem(kind: .dataSources)
    static let notionItem = SidebarSettingsMenuItem(kind: .notion)

    static func sourceItem(_ source: ContentSource) -> SidebarSettingsMenuItem {
        SidebarSettingsMenuItem(kind: .source(source))
    }
}

// MARK: - Menu Button

private struct SidebarSettingsMenuButton: View {
    let item: SidebarSettingsMenuItem
    let isActive: Bool
    let action: () -> Void
    @State private var isHovering: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: item.icon)
                    .scaledFont(.body, weight: .semibold)
                    .foregroundStyle(isActive ? item.accentColor : .secondary)
                Text(item.title)
                    .scaledFont(.body, weight: isActive ? .semibold : .regular)
                    .foregroundStyle(isActive ? .primary : .secondary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isActive ? item.accentColor.opacity(0.12) : hoverBackground)
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeInOut(duration: 0.15), value: isActive)
        .animation(.easeInOut(duration: 0.1), value: isHovering)
    }

    private var hoverBackground: Color {
        isHovering ? Color.primary.opacity(0.06) : .clear
    }
}

// MARK: - Data Sources Tab

private struct SidebarSettingsDataSourcesTab: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    var body: some View {
        List {
            Section {
                ForEach(ContentSource.customOrder, id: \.rawValue) { source in
                    let provider = source.uiProvider
                    DataSourceToggleRow(provider: provider)
                }
            } header: {
                Text("Data Sources")
                    .scaledFont(.headline, weight: .semibold)
                    .foregroundStyle(.primary)
            } footer: {
                Text("Toggle sources to show them in the sidebar and commands.")
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(Color.primary.opacity(0.03))
        .padding(12)
        .environment(\.defaultMinListRowHeight, 28 * fontScaleManager.scaleFactor)
    }
}

// MARK: - Data Source Toggle Row

private struct DataSourceToggleRow: View {
    let provider: any DataSourceUIProvider
    @AppStorage private var isEnabled: Bool

    init(provider: any DataSourceUIProvider) {
        self.provider = provider
        _isEnabled = AppStorage(wrappedValue: provider.defaultEnabled, provider.enabledStorageKey)
    }

    var body: some View {
        Toggle(isOn: $isEnabled) {
            HStack(spacing: 8) {
                Image(systemName: provider.iconName)
                    .scaledFont(.body, weight: .semibold)
                    .foregroundStyle(provider.accentColor)
                Text(provider.displayName)
                    .scaledFont(.body)
            }
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        .help(String(localized: "Show this source in the main list"))
    }
}

// MARK: - Settings Tab

private struct SidebarSettingsDataSourceSettingsTab: View {
    let source: ContentSource
    @Binding var isEnabled: Bool
    @Environment(\.fontScale) private var fontScale

    var body: some View {
        VStack(spacing: 12) {
            if isEnabled {
                settingsView(for: source)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .layoutPriority(1)
            } else {
                disabledState
            }
        }
        .padding(12)
    }

    private var disabledState: some View {
        VStack(spacing: 12) {
            Image(systemName: source.icon)
                .scaledFont(.title2, weight: .semibold)
                .foregroundStyle(source.accentColor)
            Text("\(source.displayName) is disabled")
                .scaledFont(.headline, weight: .semibold)
            Text("Enable this data source to access its settings.")
                .scaledFont(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 240 * fontScale)
            Button {
                isEnabled = true
            } label: {
                Text("Enable \(source.displayName)")
                    .scaledFont(.body, weight: .semibold)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func settingsView(for source: ContentSource) -> some View {
        switch source {
        case .appleBooks:
            AppleBooksSettingsView()
        case .goodLinks:
            GoodLinksSettingsView()
        case .weRead:
            WeReadSettingsView()
        case .dedao:
            DedaoSettingsView()
        case .chats:
            OCRSettingsView()
        }
    }
}

// MARK: - Preview

#Preview {
    SidebarSettingsView(isPresented: .constant(true))
        .frame(width: 360, height: 520)
        .applyFontScale()
}

import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel = GoodLinksSettingsViewModel()
    @State private var isPickingGoodLinks: Bool = false

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text(String(localized: "Enable GoodLinks source", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Show GoodLinks in the main list and commands", table: "Settings"))
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text(String(localized: "Data Source", table: "Settings"))
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Sync Settings
            Section {
                LabeledContent {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.goodLinksDbId) { _, _ in
                            viewModel.save()
                        }
                } label: {
                    Text(String(localized: "Database ID (optional)", table: "Settings"))
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text(String(localized: "Smart Auto Sync", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Sync every 5 minutes, only changed content", table: "Settings"))
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }

                // GoodLinks 数据目录授权按钮
                Button(action: {
                    guard !isPickingGoodLinks else { return }
                    isPickingGoodLinks = true
                    GoodLinksPicker.pickGoodLinksFolder()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        isPickingGoodLinks = false
                    }
                }) {
                    HStack {
                        Label(String(localized: "Select Folder", table: "Common"), systemImage: "folder")
                            .scaledFont(.body)
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .scaledFont(.body)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help(String(localized: "Choose data folder and load notes", table: "Settings"))
            } header: {
                Text(String(localized: "Sync Settings", table: "Settings"))
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }

        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle(String(localized: "GoodLinks", table: "Common"))
    }
}

struct GoodLinksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksSettingsView()
    }
}
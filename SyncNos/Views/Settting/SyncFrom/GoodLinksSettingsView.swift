import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel = GoodLinksSettingsViewModel()
    @State private var isPickingGoodLinks: Bool = false

    var body: some View {
        List {
            Section(header: Label("Notion Sync Setting", systemImage: "n.square")) {
                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.goodLinksDbId) { _, _ in
                            viewModel.save()
                        }
                }

                Toggle("Enable GoodLinks source", isOn: $viewModel.isSourceEnabled)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Show GoodLinks in the main list and commands")
                    .onChange(of: viewModel.isSourceEnabled) { _, _ in
                        viewModel.save()
                    }

                Toggle("Auto Sync (24 hours)", isOn: $viewModel.autoSync)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Enable automatic sync for GoodLinks")
                    .onChange(of: viewModel.autoSync) { _, _ in
                        viewModel.save()
                    }

                // GoodLinks 数据目录授权按钮（从 SettingsView 移动过来）
                Button(action: {
                    guard !isPickingGoodLinks else { return }
                    isPickingGoodLinks = true
                    GoodLinksPicker.pickGoodLinksFolder()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        isPickingGoodLinks = false
                    }
                }) {
                    HStack {
                        Label("Select Folder", systemImage: "folder")
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .scaledFont(.body)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help("Choose data folder and load notes")
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .foregroundColor(.secondary)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("GoodLinks")
    }
}

struct GoodLinksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksSettingsView()
    }
}
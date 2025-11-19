import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel = GoodLinksSettingsViewModel()
    @State private var isPickingGoodLinks: Bool = false

    var body: some View {
        List {
            Section(header: Label("Notion Sync Setting", systemImage: "bookmark")) {
                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.goodLinksDbId) { _ in
                            viewModel.save()
                        }
                }

                Toggle("Auto Sync (24 hours)", isOn: $viewModel.autoSync)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Enable automatic sync for GoodLinks (checked means AutoSyncService will run)")
                    .onChange(of: viewModel.autoSync) { _ in
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
                        Label("Open GoodLinks data", systemImage: "folder")
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .font(.body.weight(.regular))
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help("Choose GoodLinks group container and load data")
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
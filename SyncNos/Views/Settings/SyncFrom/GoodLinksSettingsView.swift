import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel: GoodLinksSettingsViewModel
    @State private var isPickingGoodLinks: Bool = false
    @State private var showingAutoFetchDebugSheet: Bool = false

    @MainActor
    init(viewModel: GoodLinksSettingsViewModel? = nil) {
        if let viewModel {
            _viewModel = StateObject(wrappedValue: viewModel)
        } else {
            _viewModel = StateObject(wrappedValue: GoodLinksSettingsViewModel())
        }
    }

    var body: some View {
        List {
            // MARK: - Sync Settings
            Section {
                LabeledContent {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.goodLinksDbId) { _, _ in
                            viewModel.save()
                        }
                } label: {
                    Text("Database ID (optional)")
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text("Smart Auto Sync")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Sync every 5 minutes, only changed content")
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
                        Label("Select Folder", systemImage: "folder")
                            .scaledFont(.body)
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .scaledFont(.body)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help("Choose data folder and load notes")
            } header: {
                Text("Sync Settings")
                    .scaledFont(.headline)
            }

            Section {
                Button {
                    showingAutoFetchDebugSheet = true
                } label: {
                    HStack {
                        Image(systemName: "ladybug")
                            .foregroundStyle(.orange)
                        Text("GoodLinks Auto Fetch Debug")
                            .scaledFont(.body)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            } header: {
                Text("Debug")
                    .scaledFont(.headline)
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("GoodLinks")
        .sheet(isPresented: $showingAutoFetchDebugSheet) {
            GoodLinksAutoFetchDebugView()
        }
    }
}

struct GoodLinksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksSettingsView()
    }
}

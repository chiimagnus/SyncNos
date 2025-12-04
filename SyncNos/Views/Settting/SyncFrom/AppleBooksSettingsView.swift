import SwiftUI

struct AppleBooksSettingsView: View {
    @StateObject private var viewModel = AppleBooksSettingsViewModel()
    @State private var isPickingBooks: Bool = false

    var body: some View {
        List {
            Section(header: Label("Notion Sync Setting", systemImage: "n.square")) {
                Picker("Sync Mode", selection: $viewModel.syncMode) {
                    Text("One page per book").tag("single")
                    Text("One database per book").tag("perBook")
                }
                .onChange(of: viewModel.syncMode) { _, _ in
                    viewModel.saveSyncMode()
                }

                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for Apple Books", text: $viewModel.appleBooksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.appleBooksDbId) { _, _ in
                            viewModel.save()
                        }
                }

                Toggle("Enable Apple Books source", isOn: $viewModel.isSourceEnabled)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Show Apple Books in the main list and commands")
                    .onChange(of: viewModel.isSourceEnabled) { _, _ in
                        viewModel.save()
                    }

                Toggle("Auto Sync (24 hours)", isOn: $viewModel.autoSync)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Enable automatic sync for Apple Books")
                    .onChange(of: viewModel.autoSync) { _, _ in
                        viewModel.save()
                    }

                // Apple Books 数据目录授权按钮（从 SettingsView 移动过来）
                Button(action: {
                    guard !isPickingBooks else { return }
                    isPickingBooks = true
                    AppleBooksPicker.pickAppleBooksContainer()
                    // 延迟重置状态，防止快速重复点击
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        isPickingBooks = false
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
        .navigationTitle("Apple Books")
    }
}

struct AppleBooksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        AppleBooksSettingsView()
    }
}
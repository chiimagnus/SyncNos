import SwiftUI

struct BackgroundActivityView: View {
    @StateObject private var viewModel = BackgroundActivityViewModel()

    var body: some View {
        Form {
            Toggle(isOn: $viewModel.isEnabled) {
                Text("Enable Background Activity (Login Item)")
            }
            .onChange(of: viewModel.isEnabled) { new in
                viewModel.setEnabled(new)
            }

            HStack {
                Text("Status:")
                Spacer()
                Text(viewModel.statusText)
                    .foregroundColor(.secondary)
            }

            if viewModel.statusText.contains("requires user approval") || viewModel.statusText.contains("requires") {
                Button("Open System Settings") {
                    viewModel.openSystemSettings()
                }
                .help("Open System Settings to allow the helper to run in background")
            }
        }
        .padding()
        .navigationTitle("Background Activity")
    }
}

struct BackgroundActivityView_Previews: PreviewProvider {
    static var previews: some View {
        BackgroundActivityView()
    }
}



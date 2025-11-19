import SwiftUI

struct WeReadSettingsView: View {
    @State private var isAutoSyncEnabled: Bool = UserDefaults.standard.bool(forKey: "autoSync.weRead")
    @State private var isLoggedIn = WeReadAuthService.shared.isLoggedIn
    @State private var showLoginSheet = false
    
    var body: some View {
        Form {
            Section(header: Text("Authentication")) {
                HStack {
                    Text("Status:")
                    if isLoggedIn {
                        Text("Logged In")
                            .foregroundColor(.green)
                        Button("Log Out") {
                            WeReadAuthService.shared.logout()
                        }
                    } else {
                        Text("Not Logged In")
                            .foregroundColor(.red)
                        Button("Log In") {
                            showLoginSheet = true
                        }
                    }
                }
            }
            
            Section(header: Text("Sync")) {
                Toggle("Enable Auto Sync", isOn: $isAutoSyncEnabled)
                    .onChange(of: isAutoSyncEnabled) { newValue in
                        UserDefaults.standard.set(newValue, forKey: "autoSync.weRead")
                    }
                
                Button("Sync Now") {
                     if let provider = DIContainer.shared.syncProviders.first(where: { $0.source == .weRead }) {
                         Task {
                             try? await provider.triggerAutoSync()
                         }
                     }
                }
                .disabled(!isLoggedIn)
            }
        }
        .padding()
        .sheet(isPresented: $showLoginSheet) {
            WeReadLoginSheet()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("WeReadLoginStatusChanged"))) { _ in
            isLoggedIn = WeReadAuthService.shared.isLoggedIn
        }
    }
}


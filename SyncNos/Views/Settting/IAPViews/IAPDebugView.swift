import SwiftUI

struct IAPDebugView: View {
    @StateObject private var viewModel = IAPDebugViewModel()
    
    var body: some View {
        List {
            // Environment Section
            Section(header: Text("Environment")) {
                LabeledContent("Environment Type") {
                    Text(viewModel.debugInfo?.environmentType.description ?? "Unknown")
                        .foregroundStyle(viewModel.isDevEnvironment ? .green : .red)
                        .fontWeight(.semibold)
                }
            }
            
            // Purchase Status Section
            Section(header: Text("Purchase Status")) {
                StatusRow(
                    title: "Annual Subscription",
                    value: viewModel.debugInfo?.hasPurchasedAnnual ?? false
                )
                StatusRow(
                    title: "Lifetime License",
                    value: viewModel.debugInfo?.hasPurchasedLifetime ?? false
                )
            }
            
            // Trial Period Section
            Section(header: Text("Trial Period")) {
                LabeledContent("In Trial Period") {
                    Text(viewModel.debugInfo?.isInTrialPeriod ?? false ? "Yes" : "No")
                        .foregroundStyle(viewModel.debugInfo?.isInTrialPeriod ?? false ? .green : .red)
                }
                LabeledContent("Days Remaining") {
                    Text("\(viewModel.debugInfo?.trialDaysRemaining ?? 0)")
                        .foregroundStyle(.secondary)
                }
                if let firstLaunch = viewModel.debugInfo?.firstLaunchDate {
                    LabeledContent("First Launch") {
                        Text(firstLaunch, style: .date)
                            .font(.caption)
                    }
                }
            }
            
            // Actions Section (Development Only)
            if viewModel.isDevEnvironment {
                Section(header: Text("Actions")) {
                    Button(action: {
                        viewModel.requestReset()
                    }) {
                        Label("Reset All IAP Data", systemImage: "trash.fill")
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.bordered)
                    
                    Menu {
                        Button("Purchased Annual") {
                            viewModel.simulateState(.purchasedAnnual)
                        }
                        Button("Purchased Lifetime") {
                            viewModel.simulateState(.purchasedLifetime)
                        }
                        Divider()
                        Button("Trial Day 1") {
                            viewModel.simulateState(.trialDay(1))
                        }
                        Button("Trial Day 7") {
                            viewModel.simulateState(.trialDay(7))
                        }
                        Button("Trial Day 15") {
                            viewModel.simulateState(.trialDay(15))
                        }
                        Button("Trial Day 29") {
                            viewModel.simulateState(.trialDay(29))
                        }
                        Divider()
                        Button("Trial Expired") {
                            viewModel.simulateState(.trialExpired)
                        }
                    } label: {
                        Label("Simulate State", systemImage: "wand.and.stars")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("IAP Debug Panel")
        .onAppear {
            viewModel.onAppear()
        }
        .alert("Confirm Reset", isPresented: $viewModel.showResetConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Reset", role: .destructive) {
                viewModel.confirmReset()
            }
        } message: {
            Text("This will clear all IAP purchase data and trial period information. This action cannot be undone.")
        }
        .alert("Result", isPresented: $viewModel.showAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            if let message = viewModel.alertMessage {
                Text(message)
            }
        }
    }
}

#Preview {
    IAPDebugView()
}


// MARK: - Status Row Component
struct StatusRow: View {
    let title: String
    let value: Bool
    
    var body: some View {
        LabeledContent(title) {
            Image(systemName: value ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundStyle(value ? .green : .secondary)
        }
    }
}

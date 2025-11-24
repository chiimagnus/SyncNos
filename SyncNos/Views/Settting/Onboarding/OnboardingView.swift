import SwiftUI

struct OnboardingView: View {
    @StateObject private var viewModel = OnboardingViewModel()
    @AppStorage("hasCompletedOnboarding") var hasCompletedOnboarding: Bool = false
    
    var body: some View {
        ZStack {
            // Background
            VisualEffectBackground(material: .windowBackground)
                .ignoresSafeArea()
            
            VStack {
                // Content with transition
                Group {
                    switch viewModel.currentStep {
                    case .welcome:
                        OnboardingWelcomeView(viewModel: viewModel)
                    case .connectNotion:
                        OnboardingNotionView(viewModel: viewModel)
                    case .enableSources:
                        OnboardingSourcesView(viewModel: viewModel)
                    case .proAccess:
                        OnboardingProView(viewModel: viewModel)
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
                .id(viewModel.currentStep) // Force transition on step change
            }
            .frame(width: 600, height: 500) // Fixed size for onboarding window
        }
        // Ensure the window is large enough if it's the main window
        .frame(minWidth: 600, minHeight: 500)
    }
}

// MARK: - Step 1: Welcome
struct OnboardingWelcomeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        VStack(spacing: 40) {
            Spacer()
            
            // Logo Cluster
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 120, height: 120)
                
                Image(nsImage: NSImage(named: "AppIcon") ?? NSImage()) // Fallback
                    .resizable()
                    .scaledToFit()
                    .frame(width: 80, height: 80)
                    .shadow(radius: 10)
                
                // Satellite Icons
                satelliteIcon("book.fill", color: .orange, angle: -90) // Apple Books
                satelliteIcon("link", color: .blue, angle: 30)         // GoodLinks
                satelliteIcon("text.book.closed.fill", color: .green, angle: 150) // WeRead placeholder
            }
            .frame(height: 150)
            
            // Text
            VStack(spacing: 16) {
                Text("All your highlights, unified.")
                    .font(.system(size: 32, weight: .bold))
                    .multilineTextAlignment(.center)
                
                Text("Sync Apple Books, GoodLinks, and WeRead highlights\ndirectly to your Notion database.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            
            Spacer()
            
            // Button
            Button(action: { viewModel.nextStep() }) {
                Text("Start Setup")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 60)
            .padding(.bottom, 40)
        }
    }
    
    func satelliteIcon(_ systemName: String, color: Color, angle: Double) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 24))
            .foregroundStyle(.white)
            .padding(12)
            .background(color)
            .clipShape(Circle())
            .shadow(radius: 4)
            .offset(x: 90 * cos(angle * .pi / 180), y: 90 * sin(angle * .pi / 180))
    }
}

// MARK: - Step 2: Connect Notion
struct OnboardingNotionView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        VStack(spacing: 30) {
            Spacer()
            
            Image(systemName: "server.rack") // Placeholder
                .font(.system(size: 60))
                .foregroundStyle(.primary)
            
            VStack(spacing: 12) {
                Text("Connect Your Workspace")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                
                Text("We'll create a secure database in your Notion workspace\nto store all your synced highlights.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            
            Spacer()
            
            if viewModel.isNotionConnected {
                VStack(spacing: 20) {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Connected: \(viewModel.workspaceName ?? "Workspace")")
                            .font(.headline)
                    }
                    .padding()
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(10)
                    
                    Button("Continue") {
                        viewModel.nextStep()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            } else {
                Button(action: { viewModel.connectNotion() }) {
                    HStack {
                        if viewModel.isAuthorizingNotion {
                            ProgressView()
                                .controlSize(.small)
                                .padding(.trailing, 5)
                        }
                        Text("Connect Notion")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.primary)
                    .foregroundColor(Color("WindowBackgroundColor")) // Invert
                    .cornerRadius(10)
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isAuthorizingNotion)
                .padding(.horizontal, 60)
                
                if let error = viewModel.notionErrorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.caption)
                }
                
                Button("Skip for now") {
                    viewModel.nextStep()
                }
                .buttonStyle(.link)
                .foregroundStyle(.secondary)
            }
            
            Spacer()
                .frame(height: 20)
        }
        .padding()
    }
}

// MARK: - Step 3: Enable Sources
struct OnboardingSourcesView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("Enable Sources")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                Text("Choose which apps you want to sync from.")
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 40)
            
            VStack(spacing: 16) {
                // Apple Books
                SourceToggleRow(
                    icon: "book.fill",
                    color: .orange,
                    title: "Apple Books",
                    isOn: $viewModel.appleBooksEnabled
                )
                .onChange(of: viewModel.appleBooksEnabled) { _, newValue in
                    if newValue && viewModel.appleBooksPath == nil {
                        // Prompt permission if needed
                         viewModel.requestAppleBooksAccess()
                    }
                }
                
                // GoodLinks
                SourceToggleRow(
                    icon: "link",
                    color: .blue,
                    title: "GoodLinks",
                    isOn: $viewModel.goodLinksEnabled
                )
                
                // WeRead
                SourceToggleRow(
                    icon: "text.book.closed.fill",
                    color: .green,
                    title: "WeRead",
                    isOn: $viewModel.weReadEnabled
                )
                .onChange(of: viewModel.weReadEnabled) { _, newValue in
                    if newValue && !viewModel.isWeReadLoggedIn {
                        // We could show a tip here
                    }
                }
            }
            .padding(.horizontal, 40)
            
            Spacer()
            
            Button(action: { viewModel.nextStep() }) {
                Text("Continue")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 60)
            .padding(.bottom, 40)
        }
    }
}

struct SourceToggleRow: View {
    let icon: String
    let color: Color
    let title: String
    @Binding var isOn: Bool
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(color)
                .cornerRadius(8)
            
            Text(title)
                .font(.headline)
            
            Spacer()
            
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
        }
        .padding()
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        )
    }
}

// MARK: - Step 4: Pro Access
struct OnboardingProView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        PayWallView(
            presentationMode: .welcome,
            onFinish: {
                viewModel.completeOnboarding()
            }
        )
    }
}

import SwiftUI

struct OnboardingView: View {
    @StateObject private var viewModel = OnboardingViewModel()
    
    var body: some View {
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
                case .trial:
                    OnboardingTrialView(viewModel: viewModel)
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
            .id(viewModel.currentStep) // Force transition on step change
        }
        .frame(width: 600, height: 500) // Fixed size for onboarding window
        .frame(maxWidth: .infinity, maxHeight: .infinity) // 填满整个窗口
        .background(Color("BackgroundColor"))
    }
}

// MARK: - Previews

#Preview("Onboarding") {
    OnboardingView()
}

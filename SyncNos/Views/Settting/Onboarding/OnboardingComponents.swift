import SwiftUI

// MARK: - Shared Onboarding Components

/// 统一的下一步圆形按钮
struct OnboardingNextButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.right")
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 50, height: 50)
                .background(Color("OnboardingButtonColor"))
                .clipShape(Circle())
                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
        }
        .buttonStyle(.plain)
    }
}

#Preview("Next Button") {
    OnboardingNextButton { }
        .padding()
        .background(Color("BackgroundColor"))
}


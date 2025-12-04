import SwiftUI

// MARK: - Shared Onboarding Components

/// 统一的下一步圆形按钮
struct OnboardingNextButton: View {
    let action: () -> Void
    
    // MARK: - Dynamic Type Support
    @ScaledMetric(relativeTo: .title) private var iconSize: CGFloat = 20
    @ScaledMetric(relativeTo: .title) private var buttonSize: CGFloat = 50
    
    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.right")
                .font(.system(size: iconSize, weight: .semibold)) // 使用 @ScaledMetric 支持 Dynamic Type
                .foregroundColor(.white)
                .frame(width: buttonSize, height: buttonSize)
                .background(Color("OnboardingButtonColor"))
                .clipShape(Circle())
                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Next")
        // 添加 Large Content Viewer 支持
        .accessibilityShowsLargeContentViewer {
            Label("Next", systemImage: "arrow.right")
        }
    }
}

#Preview("Next Button") {
    OnboardingNextButton { }
        .padding()
        .background(Color("BackgroundColor"))
}


import SwiftUI

// MARK: - Step 1: Welcome

struct OnboardingWelcomeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        ZStack {
            // Logo Cluster - 整个视图的正中央（水平+垂直居中）
            ZStack {
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .shadow(radius: 6)
                    .frame(width: 180, height: 180)
                
                // Satellite Icons
                satelliteIcon("book.fill", color: .orange, angle: -90) // Apple Books
                satelliteIcon("bookmark.fill", color: .red, angle: 30) // GoodLinks
                satelliteIcon("text.book.closed.fill", color: .blue, angle: 150) // WeRead
            }
            
            // 底部区域 - 文字 + 箭头按钮
            VStack {
                Spacer()
                
                HStack(alignment: .center, spacing: 20) {
                    // 文字部分
                    VStack(alignment: .leading, spacing: 8) {
                        Text("All your highlights, unified.")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(Color("OnboardingTextColor"))
                        
                        Text("Sync Apple Books, GoodLinks, and WeRead highlights directly to your Notion database.")
                            .font(.subheadline)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(2)
                    }
                    
                    Spacer()
                    
                    // 右箭头按钮
                    OnboardingNextButton {
                        viewModel.nextStep()
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
        }
    }
    
    private func satelliteIcon(_ systemName: String, color: Color, angle: Double) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 20))
            .foregroundStyle(.white)
            .padding(12)
            .background(color)
            .clipShape(Circle())
            .shadow(radius: 4)
            .offset(x: 120 * cos(angle * .pi / 180), y: 120 * sin(angle * .pi / 180))
    }
}

#Preview("Welcome") {
    OnboardingWelcomeView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
}


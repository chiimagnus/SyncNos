import SwiftUI

// MARK: - Step 1: Welcome

struct OnboardingWelcomeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    private var logoSize: CGFloat { 180 * fontScaleManager.scaleFactor }
    private var satelliteIconSize: CGFloat { 20 * fontScaleManager.scaleFactor }
    private var satelliteIconPadding: CGFloat { 12 * fontScaleManager.scaleFactor }
    private var orbitRadius: CGFloat { 120 * fontScaleManager.scaleFactor }
    
    var body: some View {
        ZStack {
            // Logo Cluster - 整个视图的正中央（水平+垂直居中）
            ZStack {
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .shadow(radius: 6)
                    .frame(width: logoSize, height: logoSize)
                
                // Satellite Icons
                satelliteIcon("book.fill", color: Color("BrandAppleBooks"), angle: -90) // Apple Books
                satelliteIcon("bookmark.fill", color: Color("BrandGoodLinks"), angle: 30) // GoodLinks
                satelliteIcon("text.book.closed.fill", color: Color("BrandWeRead"), angle: 150) // WeRead
            }
            
            // 底部区域 - 文字 + 箭头按钮
            VStack {
                Spacer()
                
                HStack(alignment: .center, spacing: 20) {
                    // 文字部分
                    VStack(alignment: .leading, spacing: 8) {
                        Text("All your highlights, unified.")
                            .scaledFont(.title2, weight: .bold)
                            .foregroundStyle(Color("OnboardingTextColor"))
                        
                        Text("Sync Apple Books, GoodLinks, and WeRead highlights directly to your Notion database.")
                            .scaledFont(.subheadline)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
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
            .font(.system(size: satelliteIconSize))
            .foregroundStyle(.white)
            .padding(satelliteIconPadding)
            .background(color)
            .clipShape(Circle())
            .shadow(radius: 4)
            .offset(x: orbitRadius * cos(angle * .pi / 180), y: orbitRadius * sin(angle * .pi / 180))
    }
}

#Preview("Welcome - Default") {
    OnboardingWelcomeView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}

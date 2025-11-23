import SwiftUI

struct WelcomeView: View {
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // App Icon
            Image(systemName: "book.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.blue)
            
            // Welcome Title
            Text("Welcome to SyncNos")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            // Description
            VStack(spacing: 16) {
                Text("Sync your highlights from Apple Books, GoodLinks, and WeRead to Notion effortlessly.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                
                // Trial Info
                HStack(spacing: 8) {
                    Image(systemName: "gift.fill")
                        .foregroundStyle(.green)
                    Text("30-day free trial included")
                        .font(.headline)
                        .foregroundStyle(.primary)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.green.opacity(0.1))
                )
            }
            .padding(.horizontal, 40)
            
            Spacer()
            
            // Get Started Button
            Button(action: {
                DIContainer.shared.iapService.markWelcomeShown()
                dismiss()
            }) {
                Text("Get Started")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
        .frame(width: 500, height: 500)
        .background(VisualEffectBackground(material: .windowBackground))
    }
}

struct WelcomeView_Previews: PreviewProvider {
    static var previews: some View {
        WelcomeView()
    }
}

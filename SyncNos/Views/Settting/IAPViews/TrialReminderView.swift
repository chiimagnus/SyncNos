import SwiftUI

struct TrialReminderView: View {
    let daysRemaining: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // Icon
            Image(systemName: reminderIcon)
                .font(.system(size: 60))
                .foregroundStyle(reminderColor)
            
            // Title
            Text(reminderTitle)
                .font(.title)
                .fontWeight(.bold)
            
            // Message
            Text(reminderMessage)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            
            Spacer()
            
            // Actions
            VStack(spacing: 12) {
                Button(action: {
                    DIContainer.shared.iapService.markReminderShown()
                    dismiss()
                    openWindow(id: "setting")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        NotificationCenter.default.post(name: Notification.Name("NavigateToIAPSettings"), object: nil)
                    }
                }) {
                    Text("View Plans")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
                
                Button(action: {
                    DIContainer.shared.iapService.markReminderShown()
                    dismiss()
                }) {
                    Text("Remind Me Later")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
        .frame(width: 450, height: 400)
        .background(VisualEffectBackground(material: .windowBackground))
    }
    
    private var reminderIcon: String {
        switch daysRemaining {
        case 7: return "clock.badge.exclamationmark"
        case 3: return "exclamationmark.triangle.fill"
        case 1: return "exclamationmark.circle.fill"
        default: return "clock"
        }
    }
    
    private var reminderColor: Color {
        switch daysRemaining {
        case 7: return .blue
        case 3: return .orange
        case 1: return .red
        default: return .secondary
        }
    }
    
    private var reminderTitle: String {
        switch daysRemaining {
        case 7: return "Trial Ending Soon"
        case 3: return "Only 3 Days Left"
        case 1: return "Last Day of Trial"
        default: return "Trial Reminder"
        }
    }
    
    private var reminderMessage: String {
        "Your free trial will expire in \(daysRemaining) day\(daysRemaining == 1 ? "" : "s"). Purchase now to continue enjoying unlimited syncing."
    }
}

struct TrialReminderView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            TrialReminderView(daysRemaining: 7)
            TrialReminderView(daysRemaining: 3)
            TrialReminderView(daysRemaining: 1)
        }
    }
}

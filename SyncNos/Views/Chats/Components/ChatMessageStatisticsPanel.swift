import SwiftUI

/// Message statistics panel showing counts, characters, and other metrics
struct ChatMessageStatisticsPanel: View {
    let messages: [ChatMessage]
    let contactName: String
    
    @Environment(\.fontScale) private var fontScale
    
    private var statistics: MessageStatistics {
        MessageStatistics(messages: messages)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Message Statistics")
                .scaledFont(.headline)
                .foregroundColor(.primary)
            
            Divider()
            
            // Overview
            StatRow(icon: "text.bubble", label: "Total Messages", value: "\(statistics.totalCount)")
            StatRow(icon: "person.2", label: "From Me", value: "\(statistics.fromMeCount)")
            StatRow(icon: "person", label: "From Others", value: "\(statistics.fromOthersCount)")
            StatRow(icon: "info.circle", label: "System", value: "\(statistics.systemCount)")
            
            Divider()
            
            // Content statistics
            StatRow(icon: "character.cursor.ibeam", label: "Total Characters", value: "\(statistics.totalCharacters)")
            StatRow(icon: "text.word.spacing", label: "Average Length", value: String(format: "%.1f chars", statistics.averageLength))
            
            if statistics.longestMessage > 0 {
                StatRow(icon: "text.alignleft", label: "Longest Message", value: "\(statistics.longestMessage) chars")
            }
            
            // Senders breakdown (if multiple senders)
            if !statistics.senderBreakdown.isEmpty && statistics.senderBreakdown.count > 1 {
                Divider()
                
                Text("By Sender")
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)
                
                ForEach(Array(statistics.senderBreakdown.sorted(by: { $0.value > $1.value })), id: \.key) { sender, count in
                    HStack {
                        Text(sender)
                            .scaledFont(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("\(count)")
                            .scaledFont(.caption)
                            .foregroundColor(.primary)
                    }
                }
            }
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
    }
}

private struct StatRow: View {
    let icon: String
    let label: String
    let value: String
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(.accentColor)
                .frame(width: 20)
            
            Text(label)
                .scaledFont(.callout)
                .foregroundColor(.secondary)
            
            Spacer()
            
            Text(value)
                .scaledFont(.callout)
                .foregroundColor(.primary)
                .bold()
        }
    }
}

// MARK: - Statistics Model

private struct MessageStatistics {
    let totalCount: Int
    let fromMeCount: Int
    let fromOthersCount: Int
    let systemCount: Int
    let totalCharacters: Int
    let averageLength: Double
    let longestMessage: Int
    let senderBreakdown: [String: Int]
    
    init(messages: [ChatMessage]) {
        self.totalCount = messages.count
        
        var fromMe = 0
        var fromOthers = 0
        var system = 0
        var totalChars = 0
        var longest = 0
        var senders: [String: Int] = [:]
        
        for message in messages {
            let charCount = message.content.count
            totalChars += charCount
            longest = max(longest, charCount)
            
            if message.kind == .system {
                system += 1
            } else if message.isFromMe {
                fromMe += 1
                senders["Me", default: 0] += 1
            } else {
                fromOthers += 1
                let senderName = message.senderName ?? "Unknown"
                senders[senderName, default: 0] += 1
            }
        }
        
        self.fromMeCount = fromMe
        self.fromOthersCount = fromOthers
        self.systemCount = system
        self.totalCharacters = totalChars
        self.averageLength = totalCount > 0 ? Double(totalChars) / Double(totalCount) : 0
        self.longestMessage = longest
        self.senderBreakdown = senders
    }
}

#Preview {
    ChatMessageStatisticsPanel(
        messages: [
            ChatMessage(content: "Hello", isFromMe: true, kind: .text),
            ChatMessage(content: "Hi there!", isFromMe: false, senderName: "Alice", kind: .text),
            ChatMessage(content: "How are you doing today?", isFromMe: true, kind: .text),
            ChatMessage(content: "System message", isFromMe: false, kind: .system),
        ],
        contactName: "Chat"
    )
    .applyFontScale()
    .frame(width: 300)
    .padding()
}

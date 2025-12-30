import SwiftUI

/// Message merge/split actions sheet
struct ChatMessageMergeSheet: View {
    let messages: [ChatMessage]
    let onMerge: (String) -> Void
    let onCancel: () -> Void
    
    @State private var mergedContent: String
    @FocusState private var isFocused: Bool
    
    init(messages: [ChatMessage], onMerge: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.messages = messages
        self.onMerge = onMerge
        self.onCancel = onCancel
        _mergedContent = State(initialValue: messages.map(\.content).joined(separator: "\n"))
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Image(systemName: "arrow.triangle.merge")
                    .foregroundColor(.accentColor)
                Text("Merge Messages")
                    .scaledFont(.headline)
                Spacer()
            }
            
            // Preview of messages to merge
            VStack(alignment: .leading, spacing: 8) {
                Text("Merging \(messages.count) messages:")
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)
                
                ForEach(messages.prefix(3)) { message in
                    Text("• \(message.content)")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                
                if messages.count > 3 {
                    Text("... and \(messages.count - 3) more")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(12)
            .background(Color(NSColor.controlBackgroundColor))
            .cornerRadius(8)
            
            Divider()
            
            // Merged content editor
            VStack(alignment: .leading, spacing: 8) {
                Text("Merged Content:")
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)
                
                TextEditor(text: $mergedContent)
                    .scaledFont(.body)
                    .frame(minHeight: 120)
                    .padding(8)
                    .background(Color(NSColor.textBackgroundColor))
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.accentColor, lineWidth: 1)
                    )
                    .focused($isFocused)
            }
            
            // Actions
            HStack {
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.escape)
                
                Spacer()
                
                Button("Merge") {
                    onMerge(mergedContent)
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .buttonStyle(.borderedProminent)
                .disabled(mergedContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 500)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isFocused = true
            }
        }
    }
}

/// Message split sheet
struct ChatMessageSplitSheet: View {
    let message: ChatMessage
    let onSplit: ([String]) -> Void
    let onCancel: () -> Void
    
    @State private var splitContent: String
    @State private var splitLines: [String] = []
    @FocusState private var isFocused: Bool
    
    init(message: ChatMessage, onSplit: @escaping ([String]) -> Void, onCancel: @escaping () -> Void) {
        self.message = message
        self.onSplit = onSplit
        self.onCancel = onCancel
        _splitContent = State(initialValue: message.content)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundColor(.accentColor)
                Text("Split Message")
                    .scaledFont(.headline)
                Spacer()
            }
            
            // Instructions
            Text("Add line breaks (Enter) to split this message into multiple messages:")
                .scaledFont(.subheadline)
                .foregroundColor(.secondary)
            
            // Content editor
            TextEditor(text: $splitContent)
                .scaledFont(.body)
                .frame(minHeight: 150)
                .padding(8)
                .background(Color(NSColor.textBackgroundColor))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.accentColor, lineWidth: 1)
                )
                .focused($isFocused)
                .onChange(of: splitContent) { _, newValue in
                    updateSplitPreview(newValue)
                }
            
            // Preview
            if splitLines.count > 1 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Will create \(splitLines.count) messages:")
                        .scaledFont(.subheadline)
                        .foregroundColor(.secondary)
                    
                    ForEach(Array(splitLines.enumerated()), id: \.offset) { index, line in
                        HStack(alignment: .top, spacing: 8) {
                            Text("\(index + 1).")
                                .scaledFont(.caption)
                                .foregroundColor(.secondary)
                            Text(line)
                                .scaledFont(.caption)
                                .lineLimit(2)
                        }
                    }
                }
                .padding(12)
                .background(Color(NSColor.controlBackgroundColor))
                .cornerRadius(8)
            }
            
            // Actions
            HStack {
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.escape)
                
                Spacer()
                
                Button("Split into \(splitLines.count) Messages") {
                    onSplit(splitLines)
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .buttonStyle(.borderedProminent)
                .disabled(splitLines.count < 2)
            }
        }
        .padding(20)
        .frame(width: 500)
        .onAppear {
            updateSplitPreview(splitContent)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isFocused = true
            }
        }
    }
    
    private func updateSplitPreview(_ content: String) {
        splitLines = content
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

#Preview("Merge") {
    ChatMessageMergeSheet(
        messages: [
            ChatMessage(content: "First message", isFromMe: true),
            ChatMessage(content: "Second message", isFromMe: true),
            ChatMessage(content: "Third message", isFromMe: true)
        ],
        onMerge: { _ in },
        onCancel: {}
    )
    .applyFontScale()
}

#Preview("Split") {
    ChatMessageSplitSheet(
        message: ChatMessage(content: "First part\nSecond part\nThird part", isFromMe: true),
        onSplit: { _ in },
        onCancel: {}
    )
    .applyFontScale()
}

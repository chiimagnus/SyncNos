import SwiftUI

/// Inline message editor
struct ChatMessageEditor: View {
    let message: ChatMessage
    let onSave: (String) -> Void
    let onCancel: () -> Void
    
    @State private var editedContent: String
    @FocusState private var isFocused: Bool
    @Environment(\.fontScale) private var fontScale
    
    init(message: ChatMessage, onSave: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.message = message
        self.onSave = onSave
        self.onCancel = onCancel
        _editedContent = State(initialValue: message.content)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Editor header
            HStack {
                Image(systemName: "square.and.pencil")
                    .foregroundColor(.accentColor)
                Text("Editing Message")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                Spacer()
            }
            
            // Text editor
            TextEditor(text: $editedContent)
                .scaledFont(.body)
                .frame(minHeight: 60, maxHeight: 200)
                .padding(8)
                .background(Color(NSColor.textBackgroundColor))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.accentColor, lineWidth: 1)
                )
                .focused($isFocused)
            
            // Action buttons
            HStack {
                Spacer()
                
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.escape)
                
                Button("Save") {
                    let trimmed = editedContent.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        onSave(trimmed)
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .buttonStyle(.borderedProminent)
                .disabled(editedContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isFocused = true
            }
        }
    }
}

#Preview {
    ChatMessageEditor(
        message: ChatMessage(content: "Original message content that can be edited", isFromMe: true),
        onSave: { newContent in print("Saved: \(newContent)") },
        onCancel: { print("Cancelled") }
    )
    .applyFontScale()
    .frame(width: 400)
    .padding()
}

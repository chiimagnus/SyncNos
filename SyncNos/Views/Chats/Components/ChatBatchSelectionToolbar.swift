import SwiftUI

/// Batch selection toolbar for chat messages
struct ChatBatchSelectionToolbar: View {
    let selectedCount: Int
    let totalCount: Int
    let onSelectAll: () -> Void
    let onDeselectAll: () -> Void
    let onDelete: () -> Void
    let onSetAsFromMe: () -> Void
    let onSetAsFromOther: () -> Void
    let onSetAsSystem: () -> Void
    let onSetSenderName: () -> Void
    let onExport: () -> Void
    let onCancel: () -> Void
    
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        HStack(spacing: 12) {
            // Selection info
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.accentColor)
                Text("\(selectedCount) selected")
                    .scaledFont(.callout)
                    .foregroundColor(.primary)
            }
            
            Divider()
                .frame(height: 20)
            
            // Select all/none
            Button {
                if selectedCount == totalCount {
                    onDeselectAll()
                } else {
                    onSelectAll()
                }
            } label: {
                Text(selectedCount == totalCount ? "Deselect All" : "Select All")
                    .scaledFont(.callout)
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            // Batch actions menu
            Menu {
                Section("Classify As") {
                    Button {
                        onSetAsFromMe()
                    } label: {
                        Label("From Me", systemImage: "person.fill")
                    }
                    
                    Button {
                        onSetAsFromOther()
                    } label: {
                        Label("From Others", systemImage: "person")
                    }
                    
                    Button {
                        onSetAsSystem()
                    } label: {
                        Label("System Message", systemImage: "info.circle")
                    }
                }
                
                Divider()
                
                Button {
                    onSetSenderName()
                } label: {
                    Label("Set Sender Name", systemImage: "person.text.rectangle")
                }
                
                Button {
                    onExport()
                } label: {
                    Label("Export Selected", systemImage: "square.and.arrow.up")
                }
                
                Divider()
                
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Delete Selected", systemImage: "trash")
                }
            } label: {
                Label("Actions", systemImage: "ellipsis.circle")
                    .scaledFont(.callout)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            
            Button {
                onCancel()
            } label: {
                Text("Cancel")
                    .scaledFont(.callout)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.accentColor.opacity(0.1))
        .cornerRadius(8)
    }
}

#Preview {
    VStack(spacing: 20) {
        ChatBatchSelectionToolbar(
            selectedCount: 5,
            totalCount: 100,
            onSelectAll: {},
            onDeselectAll: {},
            onDelete: {},
            onSetAsFromMe: {},
            onSetAsFromOther: {},
            onSetAsSystem: {},
            onSetSenderName: {},
            onExport: {},
            onCancel: {}
        )
        
        ChatBatchSelectionToolbar(
            selectedCount: 100,
            totalCount: 100,
            onSelectAll: {},
            onDeselectAll: {},
            onDelete: {},
            onSetAsFromMe: {},
            onSetAsFromOther: {},
            onSetAsSystem: {},
            onSetSenderName: {},
            onExport: {},
            onCancel: {}
        )
    }
    .applyFontScale()
    .frame(width: 700)
    .padding()
}

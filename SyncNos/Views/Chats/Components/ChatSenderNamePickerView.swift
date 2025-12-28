import SwiftUI

/// 昵称选择/输入 Popover
/// - 显示本对话中已使用的昵称标签（从消息中动态提取）
/// - 提供输入框输入新昵称
struct ChatSenderNamePickerView: View {
    let usedNames: [String]
    let currentName: String?
    let onSelect: (String?) -> Void
    let onDismiss: () -> Void

    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set Sender Name")
                .scaledFont(.headline)

            Divider()

            // 本对话已使用的昵称标签区
            if !usedNames.isEmpty {
                Text("Used in this chat:")
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)

                ChatSenderNameFlowLayout(spacing: 6) {
                    ForEach(usedNames, id: \.self) { name in
                        Button {
                            selectName(name)
                        } label: {
                            Text(name)
                                .scaledFont(.callout)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(currentName == name ? Color.accentColor : Color.secondary.opacity(0.15))
                                )
                                .foregroundColor(currentName == name ? .white : .primary)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Divider()
            }

            // 输入新昵称
            Text(usedNames.isEmpty ? "Enter sender name:" : "Or enter new name:")
                .scaledFont(.subheadline)
                .foregroundColor(.secondary)

            TextField("Enter name...", text: $inputText)
                .textFieldStyle(.roundedBorder)
                .focused($isInputFocused)
                .onSubmit {
                    if !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        selectName(inputText)
                    }
                }

            Divider()

            // 按钮区
            HStack {
                Spacer()

                Button("Cancel") {
                    onDismiss()
                }
                .keyboardShortcut(.escape)

                Button("OK") {
                    if !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        selectName(inputText)
                    } else {
                        onDismiss()
                    }
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .frame(width: 280)
        .onAppear {
            inputText = currentName ?? ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isInputFocused = true
            }
        }
    }

    private func selectName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSelect(trimmed)
    }
}

// MARK: - Flow Layout（标签流式布局）

/// 简易 FlowLayout：标签自动换行
struct ChatSenderNameFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y),
                proposal: .unspecified
            )
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                if x + size.width > maxWidth, x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }
                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}

#Preview {
    ChatSenderNamePickerView(
        usedNames: ["111", "222", "333", "444"],
        currentName: "111",
        onSelect: { name in print("Selected: \(name ?? "nil")") },
        onDismiss: { print("Dismissed") }
    )
    .applyFontScale()
}


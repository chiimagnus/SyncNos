import SwiftUI

enum HighlightColorTheme: String, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"

    var displayName: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        }
    }

    func colorInfo(for index: Int) -> (color: Color, name: String) {
        switch self {
        case .appleBooks:
            let infos: [(Color, String)] = [
                (.orange, "Orange"),
                (.green, "Green"),
                (.blue, "Blue"),
                (.yellow, "Yellow"),
                (.pink, "Pink"),
                (.purple, "Purple")
            ]
            return index < infos.count ? infos[index] : (Color.gray, "Unknown")

        case .goodLinks:
            let infos: [(Color, String)] = [
                (.yellow, "Yellow"),
                (.green, "Green"),
                (.blue, "Blue"),
                (.red, "Red"),
                (.purple, "Purple"),
                (.mint, "Mint")
            ]
            return index < infos.count ? infos[index] : (Color.gray, "Unknown")
        }
    }

    var colorCount: Int {
        switch self {
        case .appleBooks: return 6
        case .goodLinks: return 6
        }
    }
}

/// 紧凑版筛选栏 - 适用于 Toolbar
struct FiltetSortBar: View {
    @Binding var noteFilter: NoteFilter
    @Binding var selectedStyles: Set<Int>
    var colorTheme: HighlightColorTheme
    var sortField: HighlightSortField
    var isAscending: Bool
    var onSortFieldChanged: ((HighlightSortField) -> Void)?
    var onAscendingChanged: ((Bool) -> Void)?

    var body: some View {
        HStack {
            // 高级筛选菜单
            Menu {
                // 笔记筛选
                Section("Notes") {
                    ForEach(NoteFilter.allCases, id: \.self) { filter in
                        Button {
                            noteFilter = filter
                        } label: {
                            Label(filter.displayName, systemImage: noteFilter == filter ? "checkmark" : "")
                        }
                    }
                }

                Divider()

                // 排序选项
                Section("Sort") {
                    ForEach(HighlightSortField.allCases, id: \.self) { field in
                        Button {
                            onSortFieldChanged?(field)
                        } label: {
                            Label(field.displayName, systemImage: sortField == field ? "checkmark" : "")
                        }
                    }

                    Button {
                        onAscendingChanged?(!isAscending)
                    } label: {
                        Label("Ascending", systemImage: isAscending ? "checkmark" : "")
                    }
                }
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
            .menuIndicator(.hidden)
            .help("Filters")

            // 颜色筛选按钮组
            HStack {
                ForEach(0..<colorTheme.colorCount, id: \.self) { colorIndex in
                    let (color, name) = colorTheme.colorInfo(for: colorIndex)
                    let isSelected = selectedStyles.isEmpty || selectedStyles.contains(colorIndex)

                    Button(action: {
                        if selectedStyles.isEmpty {
                            selectedStyles = [colorIndex]
                        } else if selectedStyles.contains(colorIndex) {
                            selectedStyles.remove(colorIndex)
                            if selectedStyles.isEmpty {
                                selectedStyles = []
                            }
                        } else {
                            selectedStyles.insert(colorIndex)
                            if selectedStyles.count == colorTheme.colorCount {
                                selectedStyles = []
                            }
                        }
                    }) {
                        Circle()
                            .fill(color)
                            .frame(width: 18, height: 18)
                            .overlay(
                                Circle()
                                    .stroke(isSelected ? Color.white : Color.gray, lineWidth: isSelected ? 2 : 1)
                            )
                            .shadow(color: color.opacity(0.3), radius: isSelected ? 2 : 0, x: 0, y: isSelected ? 1 : 0)
                    }
                    .buttonStyle(.plain)
                    .help("\(name)\(isSelected ? " (Selected)" : "")")
                }
            }
        }
        .padding(.horizontal, 8)
    }
}

struct FiltetSortBar_Previews: PreviewProvider {
    struct CompactPreviewView: View {
        @State private var noteFilter: NoteFilter = .any
        @State private var selectedStyles: Set<Int> = []
        @State private var sortField: HighlightSortField = .created
        @State private var isAscending = false

        let colorTheme: HighlightColorTheme

        var body: some View {
            FiltetSortBar(
                noteFilter: $noteFilter,
                selectedStyles: $selectedStyles,
                colorTheme: colorTheme,
                sortField: sortField,
                isAscending: isAscending,
                onSortFieldChanged: { field in
                    sortField = field
                },
                onAscendingChanged: { ascending in
                    isAscending = ascending
                }
            )
        }
    }

    static var previews: some View {
        VStack(spacing: 20) {
            CompactPreviewView(colorTheme: .appleBooks)

            CompactPreviewView(colorTheme: .goodLinks)
        }
        .padding()
        .frame(width: 600)
        .previewLayout(.sizeThatFits)
    }
}

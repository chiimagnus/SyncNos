import SwiftUI

enum HighlightColorTheme: String, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"
    case weRead = "weRead"
    case dedao = "dedao"

    var displayName: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        case .dedao: return "Dedao"
        }
    }

    private var source: HighlightSource {
        switch self {
        case .appleBooks: return .appleBooks
        case .goodLinks: return .goodLinks
        case .weRead: return .weRead
        case .dedao: return .dedao
        }
    }

    func colorInfo(for index: Int) -> (color: Color, name: String) {
        let def = HighlightColorScheme.definition(for: index, source: source)
        let color = HighlightColorUI.color(fromNotionName: def.notionName)
        return (color, def.displayName)
    }

    var colorCount: Int {
        HighlightColorScheme.allDefinitions(for: source).count
    }
}

/// 紧凑版筛选栏 - 适用于 Toolbar
struct FilterSortBar: View {
    @Binding var noteFilter: NoteFilter
    @Binding var selectedStyles: Set<Int>
    var colorTheme: HighlightColorTheme
    var sortField: HighlightSortField
    var isAscending: Bool
    var availableSortFields: [HighlightSortField] = HighlightSortField.allCases
    var onSortFieldChanged: ((HighlightSortField) -> Void)?
    var onAscendingChanged: ((Bool) -> Void)?

    var body: some View {
        HStack {
            // 高级筛选菜单
            Menu {
                // 排序选项
                Section("Sort") {
                    ForEach(availableSortFields, id: \.self) { field in
                        Button {
                            onSortFieldChanged?(field)
                        } label: {
                            Label(field.displayName, systemImage: sortField == field ? "checkmark" : "")
                        }
                    }

                    Divider()

                    Button {
                        onAscendingChanged?(!isAscending)
                    } label: {
                        Label("Ascending", systemImage: isAscending ? "checkmark" : "xmark")
                    }
                }

                Divider()

                // 笔记筛选
                Section("Filter") {
                    Button {
                        noteFilter.toggle()
                    } label: {
                        if noteFilter {
                            Label("Has Notes", systemImage: "checkmark")
                        } else {
                            Text("Has Notes")
                        }
                    }
                }
            } label: {
                Image(systemName: "line.3.horizontal.decrease")
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
            .padding(.trailing, 8)
        }
        // .padding(.horizontal, 8)
    }
}

struct FilterSortBar_Previews: PreviewProvider {
    struct CompactPreviewView: View {
        @State private var noteFilter: NoteFilter = false
        @State private var selectedStyles: Set<Int> = []
        @State private var sortField: HighlightSortField = .created
        @State private var isAscending = false

        let colorTheme: HighlightColorTheme

        var body: some View {
            FilterSortBar(
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

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

struct FilterBar: View {
    // Note filter state
    @Binding var noteFilter: NoteFilter
    @Binding var selectedStyles: Set<Int>

    // Color theme
    var colorTheme: HighlightColorTheme

    // Sort state (for displaying current sort)
    var sortField: HighlightSortField
    var isAscending: Bool
    var onSortFieldChanged: ((HighlightSortField) -> Void)?
    var onAscendingChanged: ((Bool) -> Void)?

    // Callbacks
    var onResetFilters: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                // Note filter picker
                HStack(spacing: 8) {
                    Image(systemName: "note.text")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("Notes:")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Picker("Note filter", selection: $noteFilter) {
                        ForEach(NoteFilter.allCases, id: \.self) { filter in
                            Text(filter.displayName).tag(filter)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                Divider()
                    .frame(height: 20)

                // Sort menu
                HStack(spacing: 8) {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("Sort:")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Menu {
                        // Sort field with checkmark
                        ForEach(HighlightSortField.allCases, id: \.self) { field in
                            Button {
                                onSortFieldChanged?(field)
                            } label: {
                                Label(field.displayName, systemImage: sortField == field ? "checkmark" : "")
                            }
                        }

                        Divider()

                        // Ascend toggle
                        Button {
                            onAscendingChanged?(!isAscending)
                        } label: {
                            Label("Ascending", systemImage: isAscending ? "checkmark" : "")
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(sortField.displayName)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.primary)

                            Text(isAscending ? "↑" : "↓")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Spacer()

                // Reset filters button
                Button(action: {
                    onResetFilters?()
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.caption)
                        Text("Reset")
                            .font(.caption)
                    }
                    .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Reset filters")
            }

            // Color filter row
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "paintpalette")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("Colors:")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(selectedStyles.isEmpty ? "All" : "\(selectedStyles.count) selected")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                }

                Divider()
                    .frame(height: 16)

                // Color buttons
                HStack(spacing: 8) {
                    ForEach(0..<colorTheme.colorCount, id: \.self) { colorIndex in
                        let (color, name) = colorTheme.colorInfo(for: colorIndex)
                        let isSelected = selectedStyles.isEmpty || selectedStyles.contains(colorIndex)

                        Button(action: {
                            if selectedStyles.isEmpty {
                                // If all colors are selected, unselect this one
                                selectedStyles = [colorIndex]
                            } else if selectedStyles.contains(colorIndex) {
                                selectedStyles.remove(colorIndex)
                                // If no colors selected, switch back to "all" mode
                                if selectedStyles.isEmpty {
                                    selectedStyles = []
                                }
                            } else {
                                selectedStyles.insert(colorIndex)
                                // If all colors are now selected, switch to "all" mode
                                if selectedStyles.count == colorTheme.colorCount {
                                    selectedStyles = []
                                }
                            }
                        }) {
                            Circle()
                                .fill(color)
                                .frame(width: 20, height: 20)
                                .overlay(
                                    Circle()
                                        .stroke(isSelected ? Color.white : Color.gray, lineWidth: isSelected ? 2 : 1)
                                )
                                .shadow(color: color.opacity(0.3), radius: isSelected ? 3 : 0, x: 0, y: isSelected ? 1 : 0)
                        }
                        .buttonStyle(.plain)
                        .help("\(name)\(isSelected ? " (Selected)" : "")")
                    }
                }

                Spacer()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct FilterBar_Previews: PreviewProvider {
    struct PreviewView: View {
        @State private var noteFilter: NoteFilter = .any
        @State private var selectedStyles: Set<Int> = []
        @State private var sortField: HighlightSortField = .created
        @State private var isAscending = false

        let colorTheme: HighlightColorTheme

        var body: some View {
            FilterBar(
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
            ) {
                noteFilter = .any
                selectedStyles = []
            }
        }
    }

    static var previews: some View {
        VStack(spacing: 20) {
            PreviewView(colorTheme: .appleBooks)

            PreviewView(colorTheme: .goodLinks)
                .onAppear {
                    // Second preview with different initial state
                    DispatchQueue.main.async {
                        // This won't work in preview, but shows intent
                    }
                }
        }
        .padding()
        .frame(width: 700)
        .previewLayout(.sizeThatFits)
    }
}

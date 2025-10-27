import Foundation

@MainActor
class GoodLinksDetailViewModel: ObservableObject {
    @Published var highlights: [GoodLinksHighlightRow] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?

    // Filtering state
    @Published var noteFilter: NoteFilter = .any {
        didSet {
            UserDefaults.standard.set(noteFilter.rawValue, forKey: "goodlinks_detail_note_filter")
            if currentLinkId != nil {
                loadHighlights()
            }
        }
    }

    @Published var selectedStyles: Set<Int> = [] {
        didSet {
            UserDefaults.standard.set(Array(selectedStyles).sorted(), forKey: "goodlinks_detail_selected_styles")
            if currentLinkId != nil {
                loadHighlights()
            }
        }
    }

    // Sorting state
    @Published var sortField: HighlightSortField = .created {
        didSet {
            UserDefaults.standard.set(sortField.rawValue, forKey: "goodlinks_detail_sort_field")
            if currentLinkId != nil {
                loadHighlights()
            }
        }
    }

    @Published var isAscending: Bool = false {
        didSet {
            UserDefaults.standard.set(isAscending, forKey: "goodlinks_detail_sort_ascending")
            if currentLinkId != nil {
                loadHighlights()
            }
        }
    }

    private var currentLinkId: String?
    private let service: GoodLinksDatabaseServiceExposed

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService) {
        self.service = service

        // Load initial values from UserDefaults
        if let savedNoteFilterRaw = UserDefaults.standard.string(forKey: "goodlinks_detail_note_filter"),
           let filter = NoteFilter(rawValue: savedNoteFilterRaw) {
            self.noteFilter = filter
        }
        if let savedStyles = UserDefaults.standard.array(forKey: "goodlinks_detail_selected_styles") as? [Int] {
            self.selectedStyles = Set(savedStyles)
        }
        if let savedSortFieldRaw = UserDefaults.standard.string(forKey: "goodlinks_detail_sort_field"),
           let sortField = HighlightSortField(rawValue: savedSortFieldRaw) {
            self.sortField = sortField
        }
        self.isAscending = UserDefaults.standard.object(forKey: "goodlinks_detail_sort_ascending") as? Bool ?? false
    }

    func setLink(_ link: GoodLinksLinkRow) {
        currentLinkId = link.id
        loadHighlights()
    }

    private func loadHighlights() {
        guard let linkId = currentLinkId else { return }
        isLoadingPage = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            do {
                let dbPath = self.service.defaultDatabasePath()
                var linkHighlights = try self.service.fetchHighlightsForLink(
                    dbPath: dbPath,
                    linkId: linkId,
                    limit: 1000,
                    offset: 0
                )

                // Apply filters
                linkHighlights = self.applyFiltersAndSorting(to: linkHighlights)

                Task { @MainActor in
                    self.highlights = linkHighlights
                    self.isLoadingPage = false
                }
            } catch {
                Task { @MainActor in
                    self.errorMessage = error.localizedDescription
                    self.isLoadingPage = false
                }
            }
        }
    }

    private func applyFiltersAndSorting(to highlights: [GoodLinksHighlightRow]) -> [GoodLinksHighlightRow] {
        var filtered = highlights

        // Apply note filter
        switch noteFilter {
        case .any:
            break // No filtering
        case .hasNote:
            filtered = filtered.filter { $0.note != nil && !$0.note!.isEmpty }
        case .noNote:
            filtered = filtered.filter { $0.note == nil || $0.note!.isEmpty }
        }

        // Apply color filter
        if !selectedStyles.isEmpty {
            filtered = filtered.filter { highlight in
                guard let color = highlight.color else { return false }
                return selectedStyles.contains(color)
            }
        }

        // Apply sorting (GoodLinks only has 'time' field, so created/modified use the same logic)
        filtered = filtered.sorted { lhs, rhs in
            switch sortField {
            case .created:
                if isAscending {
                    return lhs.time < rhs.time
                } else {
                    return lhs.time > rhs.time
                }
            case .modified:
                if isAscending {
                    return lhs.time < rhs.time
                } else {
                    return lhs.time > rhs.time
                }
            }
        }

        return filtered
    }

    func resetFilters() {
        noteFilter = .any
        selectedStyles = []
    }
}

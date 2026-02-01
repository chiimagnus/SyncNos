import Foundation

enum ListSortPreferenceKeys {
    enum AppleBooks {
        static let sortKey = "bookList_sort_key"
        static let sortAscending = "bookList_sort_ascending"
        static let showWithTitleOnly = "bookList_showWithTitleOnly"
    }
    
    enum GoodLinks {
        static let sortKey = "goodlinks_sort_key"
        static let sortAscending = "goodlinks_sort_ascending"
        static let showStarredOnly = "goodlinks_show_starred_only"
        static let searchText = "goodlinks_search_text"
    }
    
    enum WeRead {
        static let sortKey = "weread_sort_key"
        static let sortAscending = "weread_sort_ascending"
    }
    
    enum Dedao {
        static let sortKey = "dedao_sort_key"
        static let sortAscending = "dedao_sort_ascending"
    }
}


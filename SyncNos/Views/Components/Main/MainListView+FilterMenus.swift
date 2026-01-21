import SwiftUI

// MARK: - MainListView Filter Menus Extension

extension MainListView {
    
    // MARK: - Filter Menus
    // 使用 DataSourceFilterSections 通用组件重构，消除重复代码
    
    @ViewBuilder
    var appleBooksFilterMenu: some View {
        DataSourceFilterSections<BookListSortKey>(
            filterNotification: .appleBooksFilterChanged,
            sortKey: Binding(
                get: { appleBooksVM.sortKey },
                set: { appleBooksVM.sortKey = $0 }
            ),
            sortAscending: Binding(
                get: { appleBooksVM.sortAscending },
                set: { appleBooksVM.sortAscending = $0 }
            )
        ) {
            VMFilterToggleButton(
                title: "Titles only",
                isOn: appleBooksVM.showWithTitleOnly,
                action: { appleBooksVM.showWithTitleOnly.toggle() },
                notificationName: .appleBooksFilterChanged,
                userInfoKey: "showWithTitleOnly"
            )
        }
    }
    
    @ViewBuilder
    var goodLinksFilterMenu: some View {
        DataSourceFilterSections<GoodLinksSortKey>(
            filterNotification: .goodLinksFilterChanged,
            sortKey: Binding(
                get: { goodLinksVM.sortKey },
                set: { goodLinksVM.sortKey = $0 }
            ),
            sortAscending: Binding(
                get: { goodLinksVM.sortAscending },
                set: { goodLinksVM.sortAscending = $0 }
            )
        ) {
            VMFilterToggleButton(
                title: "Starred only",
                isOn: goodLinksVM.showStarredOnly,
                action: { goodLinksVM.showStarredOnly.toggle() },
                notificationName: .goodLinksFilterChanged,
                userInfoKey: "showStarredOnly"
            )
        }
    }
    
    @ViewBuilder
    var weReadFilterMenu: some View {
        // WeRead 只支持部分排序键
        DataSourceFilterSections<BookListSortKey>(
            filterNotification: .weReadFilterChanged,
            availableSortKeys: [.title, .highlightCount, .lastSync],
            sortKey: Binding(
                get: { weReadVM.sortKey },
                set: { weReadVM.sortKey = $0 }
            ),
            sortAscending: Binding(
                get: { weReadVM.sortAscending },
                set: { weReadVM.sortAscending = $0 }
            )
        )
    }
    
    @ViewBuilder
    var dedaoFilterMenu: some View {
        // Dedao 只支持部分排序键
        DataSourceFilterSections<BookListSortKey>(
            filterNotification: .dedaoFilterChanged,
            availableSortKeys: [.title, .highlightCount, .lastSync],
            sortKey: Binding(
                get: { dedaoVM.sortKey },
                set: { dedaoVM.sortKey = $0 }
            ),
            sortAscending: Binding(
                get: { dedaoVM.sortAscending },
                set: { dedaoVM.sortAscending = $0 }
            )
        )
    }
    
    @ViewBuilder
    var chatsFilterMenu: some View {
        // Chats 不支持排序/筛选，只有"新建对话"按钮
        Button {
            showNewConversationAlert = true
        } label: {
            Label("New Chat", systemImage: "plus.message")
        }
    }
}


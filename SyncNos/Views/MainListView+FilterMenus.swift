import SwiftUI

// MARK: - MainListView Filter Menus Extension

extension MainListView {
    
    // MARK: - Filter Menus
    
    @ViewBuilder
    var appleBooksFilterMenu: some View {
        Section("Sort") {
            ForEach(BookListSortKey.allCases, id: \.self) { key in
                Button {
                    appleBooksVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("AppleBooksFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if appleBooksVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                appleBooksVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("AppleBooksFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": appleBooksVM.sortAscending]
                )
            } label: {
                if appleBooksVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }

        Section("Filter") {
            Button {
                appleBooksVM.showWithTitleOnly.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("AppleBooksFilterChanged"),
                    object: nil,
                    userInfo: ["showWithTitleOnly": appleBooksVM.showWithTitleOnly]
                )
            } label: {
                if appleBooksVM.showWithTitleOnly {
                    Label("Titles only", systemImage: "checkmark")
                } else {
                    Text("Titles only")
                }
            }
        }
    }
    
    @ViewBuilder
    var goodLinksFilterMenu: some View {
        Section("Sort") {
            ForEach(GoodLinksSortKey.allCases, id: \.self) { key in
                Button {
                    goodLinksVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("GoodLinksFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if goodLinksVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                goodLinksVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("GoodLinksFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": goodLinksVM.sortAscending]
                )
            } label: {
                if goodLinksVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }

        Section("Filter") {
            Button {
                goodLinksVM.showStarredOnly.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("GoodLinksFilterChanged"),
                    object: nil,
                    userInfo: ["showStarredOnly": goodLinksVM.showStarredOnly]
                )
            } label: {
                if goodLinksVM.showStarredOnly {
                    Label("Starred only", systemImage: "checkmark")
                } else {
                    Text("Starred only")
                }
            }
        }
    }
    
    @ViewBuilder
    var weReadFilterMenu: some View {
        Section("Sort") {
            let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
            ForEach(availableKeys, id: \.self) { key in
                Button {
                    weReadVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("WeReadFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if weReadVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                weReadVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("WeReadFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": weReadVM.sortAscending]
                )
            } label: {
                if weReadVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }
    }
    
    @ViewBuilder
    var dedaoFilterMenu: some View {
        Section("Sort") {
            let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
            ForEach(availableKeys, id: \.self) { key in
                Button {
                    dedaoVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("DedaoFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if dedaoVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                dedaoVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("DedaoFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": dedaoVM.sortAscending]
                )
            } label: {
                if dedaoVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }
    }
    
    @ViewBuilder
    var wechatChatFilterMenu: some View {
        Button {
            showNewConversationAlert = true
        } label: {
            Label("新建对话", systemImage: "plus.message")
        }
        
        if !wechatChatVM.contacts.isEmpty {
            Divider()
            
            Button(role: .destructive) {
                wechatChatVM.clearAll()
                selectedWechatContactIds.removeAll()
            } label: {
                Label("清空所有对话", systemImage: "trash")
            }
        }
    }
}


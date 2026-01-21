import SwiftUI

// MARK: - FilterToggleButton

/// 通用筛选切换按钮
/// 用于 additionalFilters 闭包中
struct FilterToggleButton: View {
    let title: LocalizedStringKey
    @Binding var isOn: Bool
    let notificationName: Notification.Name
    let userInfoKey: String
    
    var body: some View {
        Button {
            isOn.toggle()
            NotificationCenter.default.post(
                name: notificationName,
                object: nil,
                userInfo: [userInfoKey: isOn]
            )
        } label: {
            if isOn {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}

// MARK: - DataSourceFilterSections

/// 通用数据源筛选 Section（不包含 Menu 包装）
/// 用于嵌入到现有 Menu 中
///
/// **两种使用方式**:
/// 1. 类型安全绑定（用于 ViewModel）: `sortKey: Binding<SortKey>`
/// 2. String 绑定（用于 @AppStorage）: `sortKeyRaw: Binding<String>`
struct DataSourceFilterSections<SortKey: SortKeyType>: View {
    let filterNotification: Notification.Name
    
    /// 可用的排序键（可以是全部或子集）
    let availableSortKeys: [SortKey]
    
    /// 当前排序键（类型安全）- 用于 ViewModel
    private var sortKeyBinding: Binding<SortKey>?
    /// 当前排序键（String）- 用于 @AppStorage
    private var sortKeyRawBinding: Binding<String>?
    
    @Binding var sortAscending: Bool
    
    /// 额外的筛选选项（可选）
    var additionalFilters: (() -> AnyView)? = nil
    
    // MARK: - Init: 类型安全绑定（ViewModel）
    
    init(
        filterNotification: Notification.Name,
        availableSortKeys: [SortKey] = Array(SortKey.allCases),
        sortKey: Binding<SortKey>,
        sortAscending: Binding<Bool>,
        @ViewBuilder additionalFilters: @escaping () -> some View
    ) {
        self.filterNotification = filterNotification
        self.availableSortKeys = availableSortKeys
        self.sortKeyBinding = sortKey
        self.sortKeyRawBinding = nil
        self._sortAscending = sortAscending
        self.additionalFilters = { AnyView(additionalFilters()) }
    }
    
    init(
        filterNotification: Notification.Name,
        availableSortKeys: [SortKey] = Array(SortKey.allCases),
        sortKey: Binding<SortKey>,
        sortAscending: Binding<Bool>
    ) {
        self.filterNotification = filterNotification
        self.availableSortKeys = availableSortKeys
        self.sortKeyBinding = sortKey
        self.sortKeyRawBinding = nil
        self._sortAscending = sortAscending
        self.additionalFilters = nil
    }
    
    // MARK: - Init: String 绑定（@AppStorage）
    
    init(
        filterNotification: Notification.Name,
        availableSortKeys: [SortKey] = Array(SortKey.allCases),
        sortKeyRaw: Binding<String>,
        sortAscending: Binding<Bool>,
        @ViewBuilder additionalFilters: @escaping () -> some View
    ) {
        self.filterNotification = filterNotification
        self.availableSortKeys = availableSortKeys
        self.sortKeyBinding = nil
        self.sortKeyRawBinding = sortKeyRaw
        self._sortAscending = sortAscending
        self.additionalFilters = { AnyView(additionalFilters()) }
    }
    
    init(
        filterNotification: Notification.Name,
        availableSortKeys: [SortKey] = Array(SortKey.allCases),
        sortKeyRaw: Binding<String>,
        sortAscending: Binding<Bool>
    ) {
        self.filterNotification = filterNotification
        self.availableSortKeys = availableSortKeys
        self.sortKeyBinding = nil
        self.sortKeyRawBinding = sortKeyRaw
        self._sortAscending = sortAscending
        self.additionalFilters = nil
    }
    
    // MARK: - Helper
    
    private func isKeySelected(_ key: SortKey) -> Bool {
        if let binding = sortKeyBinding {
            return binding.wrappedValue == key
        } else if let rawBinding = sortKeyRawBinding {
            return rawBinding.wrappedValue == key.rawValue
        }
        return false
    }
    
    private func selectKey(_ key: SortKey) {
        if let binding = sortKeyBinding {
            binding.wrappedValue = key
        } else if let rawBinding = sortKeyRawBinding {
            rawBinding.wrappedValue = key.rawValue
        }
    }
    
    // MARK: - Body
    
    var body: some View {
        Section("Sort") {
            ForEach(availableSortKeys, id: \.self) { key in
                Button {
                    selectKey(key)
                    NotificationCenter.default.post(
                        name: filterNotification,
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if isKeySelected(key) {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }
            
            Divider()
            
            Button {
                sortAscending.toggle()
                NotificationCenter.default.post(
                    name: filterNotification,
                    object: nil,
                    userInfo: ["sortAscending": sortAscending]
                )
            } label: {
                if sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }
        
        if let filters = additionalFilters {
            Section("Filter") {
                filters()
            }
        }
    }
}

// MARK: - VMFilterToggleButton

/// ViewModel 属性筛选切换按钮
/// 直接操作 ViewModel 属性而非 @AppStorage
struct VMFilterToggleButton: View {
    let title: LocalizedStringKey
    let isOn: Bool
    let action: () -> Void
    let notificationName: Notification.Name
    let userInfoKey: String
    
    var body: some View {
        Button {
            action()
            NotificationCenter.default.post(
                name: notificationName,
                object: nil,
                userInfo: [userInfoKey: !isOn]
            )
        } label: {
            if isOn {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}


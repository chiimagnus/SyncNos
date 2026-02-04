import SwiftUI

// MARK: - NotionOpenContextMenuItem

/// List 行右键菜单中的“打开 Notion”入口（统一处理：解析目标 + 打开方式）。
struct NotionOpenContextMenuItem: View {
    let sourceKey: String
    let assetId: String

    private var notionConfig: NotionConfigStoreProtocol {
        DIContainer.shared.notionConfigStore
    }

    private var linkService: NotionLinkServiceProtocol {
        DIContainer.shared.notionLinkService
    }

    var body: some View {
        Button {
            Task { @MainActor in
                await linkService.openNotionTargetForItem(sourceKey: sourceKey, assetId: assetId)
            }
        } label: {
            Label(menuTitle, systemImage: "arrow.up.right.square")
        }
        .disabled(!linkService.canOpenNotionTargetForItem(sourceKey: sourceKey, assetId: assetId))
    }

    private var menuTitle: String {
        if sourceKey == "appleBooks",
           (notionConfig.syncMode ?? NotionSyncStrategy.singleDatabase.rawValue) == NotionSyncStrategy.perBookDatabase.rawValue {
            return "Go to Notion Database"
        }
        return "Go to Notion Page"
    }
}


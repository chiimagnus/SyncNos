import SwiftUI

struct UserGuideView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("SyncNos User Guide")
                .font(.title)
                .fontWeight(.bold)

            VStack(alignment: .leading, spacing: 8) {
                Text("快速开始")
                    .font(.headline)
                VStack(alignment: .leading, spacing: 6) {
                    Text("1. 在 App Store 下载并安装 SyncNos。")
                    Text("2. 打开设置，填写 Notion 的凭据：NOTION_KEY 和 NOTION_PAGE_ID，点击保存。")
                    Text("3. 在 Notion 的 ‘集成’ 页面授权该集成访问对应页面。")
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("同步到 Notion")
                    .font(.headline)
                VStack(alignment: .leading, spacing: 6) {
                    Text("- 在左侧列表选择一本书，右侧工具栏点击 ‘Sync’ 进行同步。")
                    Text("- 或在菜单 View → ‘Sync Current Book to Notion’ 触发对当前书籍的同步。")
                }
            }

            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(minWidth: 420)
    }
}

struct UserGuideView_Previews: PreviewProvider {
    static var previews: some View {
        UserGuideView()
    }
}



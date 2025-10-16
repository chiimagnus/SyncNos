import SwiftUI
import MarkdownUI

struct UserGuideView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("SyncNos User Guide")
                    .font(.title)
                    .fontWeight(.bold)

                VStack(alignment: .leading, spacing: 16) {
                    Markdown("""
                    1. Open Settings, fill in the Notion API token and Page ID in the \"Credentials\" section, then click Save.
                    2. Authorize the integration in [Notion integrations 🔗](https://www.notion.so/profile/integrations).
                    """)
                        .appMarkdownDefaults()
                }

                Spacer()
            }
            .padding()
            .background(VisualEffectBackground(material: .windowBackground))
        }
        .navigationTitle("User Guide")
        .toolbar {
            ToolbarItem { Text("") }
        }
        .frame(minWidth: 400, idealWidth: 425, maxWidth: 425)
    }
}

struct UserGuideView_Previews: PreviewProvider {
    static var previews: some View {
        UserGuideView()
    }
}

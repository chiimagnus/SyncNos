import SwiftUI

struct UserGuideView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("SyncNos User Guide")
                    .font(.title)
                    .fontWeight(.bold)

                VStack(alignment: .leading, spacing: 16) {
                    Text("1. Open Settings, fill in the Notion API token and Page ID in the \"Credentials\" section, then click Save.")
                    Text("2. Authorize the integration in [Notion integrations 🔗](https://www.notion.so/profile/integrations).")
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

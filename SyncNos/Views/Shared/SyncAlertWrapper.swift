import SwiftUI

struct SyncAlertWrapper<Content: View>: View {
    let syncMessage: String?
    let errorMessage: String?
    let successKeywords: [String]
    let content: () -> Content

    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""

    init(
        syncMessage: String?,
        errorMessage: String? = nil,
        successKeywords: [String] = ["同步完成", "增量同步完成", "全量同步完成"],
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.syncMessage = syncMessage
        self.errorMessage = errorMessage
        self.successKeywords = successKeywords
        self.content = content
    }

    var body: some View {
        content()
            .alert("Sync Error", isPresented: $showingSyncError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(syncErrorMessage)
            }
            .onChange(of: syncMessage) { newMessage in
                guard let message = newMessage, !message.isEmpty else { return }
                if !isSuccessSyncMessage(message, keywords: successKeywords) {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
            .onChange(of: errorMessage) { newError in
                if let err = newError, !err.isEmpty {
                    syncErrorMessage = err
                    showingSyncError = true
                }
            }
            .onAppear {
                if let err = errorMessage, !err.isEmpty {
                    syncErrorMessage = err
                    showingSyncError = true
                }
            }
    }
}



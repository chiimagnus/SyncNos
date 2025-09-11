import SwiftUI

struct NotionConfigView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var databaseId: String = NotionConfigStore.shared.loadDatabaseId() ?? ""
    @State private var apiToken: String = (try? NotionConfigStore.shared.loadToken()) ?? ""
    @State private var apiVersion: String = NotionConfigStore.shared.loadAPIVersion()
    @State private var errorMessage: String?
    @State private var saved = false
    @State private var validating = false
    @State private var validationMessage: String?
    @State private var validationSuccess = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Notion 配置").font(.title2).bold()
            Group {
                LabeledContent("Database ID") {
                    HStack(spacing: 8) {
                        TextField("notion database id", text: $databaseId)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                            .frame(minWidth: 420)
                        Button(validating ? "验证中…" : "验证") {
                            validateDatabaseId()
                        }
                        .disabled(validating || databaseId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ((try? NotionConfigStore.shared.loadToken()) ?? "").isEmpty))
                    }
                }
                LabeledContent("API Token") {
                    SecureField("secret_xxx", text: $apiToken)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                }
                LabeledContent("API Version") {
                    TextField("2025-09-03", text: $apiVersion)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                }
            }
            .padding(.top, 8)

            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
            }
            if let validationMessage = validationMessage {
                Text(validationMessage)
                    .foregroundColor(validationSuccess ? .green : .red)
            }
            if saved {
                Text("已保存")
                    .foregroundColor(.green)
            }

            HStack {
                Spacer()
                Button("取消") { dismiss() }
                Button("保存") { save() }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.top, 8)
        }
        .padding(20)
    }

    private func save() {
        errorMessage = nil
        saved = false
        let trimmedDbId = databaseId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDbId.isEmpty else { errorMessage = "Database ID 不能为空"; return }
        let trimmedToken = apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else { errorMessage = "API Token 不能为空"; return }
        NotionConfigStore.shared.saveDatabaseId(trimmedDbId)
        NotionConfigStore.shared.saveAPIVersion(apiVersion)
        do {
            try NotionConfigStore.shared.saveToken(trimmedToken)
            saved = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func validateDatabaseId() {
        validationMessage = nil
        validationSuccess = false
        validating = true
        let trimmedDbId = databaseId.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? ((try? NotionConfigStore.shared.loadToken()) ?? "") : apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let version = apiVersion
        guard !trimmedDbId.isEmpty else {
            validationMessage = "Database ID 不能为空"
            validationSuccess = false
            validating = false
            return
        }
        guard !token.isEmpty else {
            validationMessage = "API Token 不能为空"
            validationSuccess = false
            validating = false
            return
        }
        Task {
            defer { validating = false }
            do {
                let notion = NotionService(configuration: .init(apiToken: token, apiVersion: version))
                let (_, url) = try await notion.fetchDatabase(databaseId: trimmedDbId)
                validationMessage = url != nil ? "验证成功：可访问数据库 (\(url!))" : "验证成功：可访问数据库"
                validationSuccess = true
            } catch {
                validationMessage = error.localizedDescription
                validationSuccess = false
            }
        }
    }
}

struct NotionConfigView_Previews: PreviewProvider {
    static var previews: some View {
        NotionConfigView()
            .frame(width: 560)
    }
}



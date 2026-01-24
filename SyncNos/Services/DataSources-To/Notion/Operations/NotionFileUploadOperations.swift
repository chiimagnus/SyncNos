import Foundation

// MARK: - Notion File Upload Operations

final class NotionFileUploadOperations {
    struct FileUpload: Decodable {
        let object: String
        let id: String
        let status: String
        let upload_url: String?
        let complete_url: String?
        let file_import_result: String?
        let filename: String?
        let content_type: String?
        let content_length: Int?
        let expiry_time: String?
    }

    enum FileUploadError: LocalizedError {
        case invalidResponse
        case missingUploadId
        case missingUploadURL
        case failed(String)
        case expired
        case timedOut

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                return "Invalid file upload response"
            case .missingUploadId:
                return "Missing file upload id"
            case .missingUploadURL:
                return "Missing upload URL"
            case .failed(let message):
                return "File upload failed: \(message)"
            case .expired:
                return "File upload expired"
            case .timedOut:
                return "File upload timed out"
            }
        }
    }

    private let requestHelper: NotionRequestHelper
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.logger = logger
    }

    func createExternalURLUpload(
        url: URL,
        filename: String?,
        contentType: String?
    ) async throws -> FileUpload {
        let resolvedFilename = (filename ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let finalFilename = resolvedFilename.isEmpty ? defaultFilename(for: url, contentType: contentType) : resolvedFilename
        var body: [String: Any] = [
            "mode": "external_url",
            "external_url": url.absoluteString,
            "filename": finalFilename
        ]
        if let contentType, !contentType.isEmpty {
            body["content_type"] = contentType
        }
        let data = try await requestHelper.performRequest(
            path: "file_uploads",
            method: "POST",
            body: body,
            versionOverride: NotionSyncConfig.notionFileUploadVersion
        )
        return try JSONDecoder().decode(FileUpload.self, from: data)
    }

    func retrieveUpload(id: String) async throws -> FileUpload {
        let data = try await requestHelper.performRequest(
            path: "file_uploads/\(id)",
            method: "GET",
            body: nil,
            versionOverride: NotionSyncConfig.notionFileUploadVersion
        )
        return try JSONDecoder().decode(FileUpload.self, from: data)
    }


    private func defaultFilename(for url: URL, contentType: String?) -> String {
        let last = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        if !last.isEmpty, last.contains(".") {
            return sanitizeFilename(last)
        }
        if let contentType, let ext = fileExtension(for: contentType) {
            return "image.\(ext)"
        }
        return "image"
    }

    private func sanitizeFilename(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
        return cleaned.isEmpty ? "image" : cleaned
    }

    private func fileExtension(for contentType: String) -> String? {
        switch contentType.lowercased() {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/png": return "png"
        case "image/gif": return "gif"
        case "image/webp": return "webp"
        case "image/heic": return "heic"
        case "image/heif": return "heif"
        default: return nil
        }
    }

    func waitUntilUploaded(id: String) async throws -> FileUpload {
        let maxAttempts = max(1, NotionSyncConfig.fileUploadMaxAttempts)
        for attempt in 1...maxAttempts {
            let upload = try await retrieveUpload(id: id)
            switch upload.status {
            case "uploaded":
                return upload
            case "failed":
                throw FileUploadError.failed(upload.file_import_result ?? "unknown")
            case "expired":
                throw FileUploadError.expired
            case "pending":
                break
            default:
                logger.warning("[NotionFileUpload] Unknown status=\(upload.status) for id=\(id)")
            }
            if attempt < maxAttempts {
                let delayMs = NotionSyncConfig.fileUploadPollIntervalMs
                try await Task.sleep(nanoseconds: delayMs * 1_000_000)
            }
        }
        throw FileUploadError.timedOut
    }
}

import Foundation

// MARK: - Notion File Upload Operations

final class NotionFileUploadOperations {
    fileprivate enum JSONValue: Decodable {
        case string(String)
        case number(Double)
        case object([String: JSONValue])
        case array([JSONValue])
        case bool(Bool)
        case null

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .null
            } else if let value = try? container.decode(String.self) {
                self = .string(value)
            } else if let value = try? container.decode(Double.self) {
                self = .number(value)
            } else if let value = try? container.decode(Bool.self) {
                self = .bool(value)
            } else if let value = try? container.decode([String: JSONValue].self) {
                self = .object(value)
            } else if let value = try? container.decode([JSONValue].self) {
                self = .array(value)
            } else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
            }
        }
    }

    struct FileUpload: Decodable {

        let object: String
        let id: String
        let status: String
        let upload_url: String?
        let complete_url: String?
        fileprivate let file_import_result: JSONValue?
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
        let resolved = resolveUploadInfo(url: url, filename: filename, contentType: contentType)
        var body: [String: Any] = [
            "mode": "external_url",
            "external_url": url.absoluteString,
            "filename": resolved.filename
        ]
        if let contentType = resolved.contentType, !contentType.isEmpty {
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


    private func resolveUploadInfo(
        url: URL,
        filename: String?,
        contentType: String?
    ) -> (filename: String, contentType: String?) {
        let cleanedFilename = sanitizeFilename((filename ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        var resolvedContentType = contentType?.trimmingCharacters(in: .whitespacesAndNewlines)
        var baseName = "image"
        var ext: String?

        if !cleanedFilename.isEmpty {
            let components = filenameComponents(from: cleanedFilename)
            if !components.base.isEmpty { baseName = components.base }
            ext = components.ext
        } else {
            let last = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            if !last.isEmpty {
                let components = filenameComponents(from: last)
                if !components.base.isEmpty { baseName = components.base }
                ext = components.ext
            }
        }

        if ext == nil {
            ext = extensionFromQuery(url)
        }
        if ext == nil, let resolvedContentType, let extFromContentType = fileExtension(for: resolvedContentType) {
            ext = extFromContentType
        }
        if ext == nil {
            ext = "jpg"
        }
        if resolvedContentType == nil, let ext, let inferredType = self.contentType(forExtension: ext) {
            resolvedContentType = inferredType
        }

        let finalFilename = ext.map { "\(baseName).\($0)" } ?? baseName
        return (finalFilename, resolvedContentType)
    }

    private func filenameComponents(from name: String) -> (base: String, ext: String?) {
        let nsName = name as NSString
        let base = nsName.deletingPathExtension
        let ext = normalizedExtension(nsName.pathExtension)
        return (base, ext)
    }

    private func extensionFromQuery(_ url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems, !items.isEmpty else {
            return nil
        }
        let keys = ["wx_fmt", "format", "fm", "ext", "type"]
        for key in keys {
            if let value = items.first(where: { $0.name.lowercased() == key })?.value,
               let normalized = normalizedExtension(value) {
                return normalized
            }
        }
        return nil
    }

    private func sanitizeFilename(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
        return cleaned.isEmpty ? "image" : cleaned
    }

    private func normalizedExtension(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return nil }
        let cleaned = trimmed.hasPrefix(".") ? String(trimmed.dropFirst()) : trimmed
        switch cleaned {
        case "jpg", "jpeg": return "jpg"
        case "png": return "png"
        case "gif": return "gif"
        case "webp": return "webp"
        case "heic": return "heic"
        case "heif": return "heif"
        default: return nil
        }
    }

    private func contentType(forExtension ext: String) -> String? {
        switch ext.lowercased() {
        case "jpg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        default: return nil
        }
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


    private func describeFileImportResult(_ value: JSONValue?) -> String {
        guard let value else { return "unknown" }
        switch value {
        case .string(let str):
            return str
        case .number(let num):
            return String(num)
        case .bool(let flag):
            return String(flag)
        case .null:
            return "null"
        case .array(let items):
            return "[\(items.count) items]"
        case .object(let dict):
            return "{\(dict.keys.joined(separator: ","))}"
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
                throw FileUploadError.failed(describeFileImportResult(upload.file_import_result))
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

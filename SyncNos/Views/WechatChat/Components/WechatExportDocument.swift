import SwiftUI
import UniformTypeIdentifiers

/// 用于 SwiftUI `fileExporter` 的文档类型
struct WechatExportDocument: FileDocument {
    /// 支持读取的类型
    static var readableContentTypes: [UTType] {
        [.json, .plainText, UTType(filenameExtension: "md")].compactMap { $0 }
    }

    /// 支持写入的类型 - 根据 format 动态返回
    var writableContentTypes: [UTType] {
        [format.utType]
    }

    let content: String
    let format: WechatExportFormat

    init(content: String, format: WechatExportFormat) {
        self.content = content
        self.format = format
    }

    init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents {
            content = String(data: data, encoding: .utf8) ?? ""
        } else {
            content = ""
        }
        format = .json
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let data = content.data(using: .utf8) ?? Data()
        return FileWrapper(regularFileWithContents: data)
    }
}



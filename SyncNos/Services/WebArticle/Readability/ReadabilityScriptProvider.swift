import Foundation

// MARK: - Readability Script Provider

/// Readability.js 脚本加载器（从 App Bundle 读取）。
///
/// 注意：
/// - Readability.js 是第三方 JS 源码（Apache-2.0），存放在 `Services/WebArticle/ThirdParty/Readability/`。
/// - 这里通过 Bundle 查找并缓存脚本内容，避免每次抓取都做 IO。
enum ReadabilityScriptProvider {
    private static let fileName = "Readability"
    private static let fileExtension = "js"

    private static let lock = NSLock()
    private static var cachedScript: String?

    static func loadScript() throws -> String {
        lock.lock()
        defer { lock.unlock() }

        if let cachedScript {
            return cachedScript
        }

        guard let url = findScriptURL() else {
            throw ReadabilityScriptError.scriptNotFound
        }

        let script = try String(contentsOf: url, encoding: .utf8)
        cachedScript = script
        return script
    }

    private static func findScriptURL() -> URL? {
        // 1) 尝试直接按文件名查找（不依赖 bundle 内的目录结构）
        if let url = Bundle.main.url(forResource: fileName, withExtension: fileExtension) {
            return url
        }

        // 2) 兜底：遍历所有 js 资源并按文件名匹配
        let urls = Bundle.main.urls(forResourcesWithExtension: fileExtension, subdirectory: nil) ?? []
        return urls.first { $0.lastPathComponent == "\(fileName).\(fileExtension)" }
    }
}

enum ReadabilityScriptError: Error {
    case scriptNotFound
}


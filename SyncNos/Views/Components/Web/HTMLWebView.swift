import SwiftUI
import WebKit

// MARK: - HTML WebView

/// 通用 HTML WebView 组件，用于渲染文章内容（含图片与样式）
/// 
/// 特点：
/// - 自动注入统一 CSS 样式（响应式图片、字体、排版）
/// - 支持相对 URL 解析（baseURL）
/// - 点击链接时在外部浏览器打开
struct HTMLWebView: NSViewRepresentable {
    // MARK: - Properties
    
    let html: String
    let baseURL: URL?
    
    // MARK: - Initialization
    
    init(html: String, baseURL: URL? = nil) {
        self.html = html
        self.baseURL = baseURL
    }
    
    // MARK: - NSViewRepresentable
    
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent() // 不需要持久化
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        
        // 禁用上下文菜单（可选）
        // webView.allowsMagnification = false
        
        return webView
    }
    
    func updateNSView(_ webView: WKWebView, context: Context) {
        let styledHTML = buildStyledHTML(html)
        webView.loadHTMLString(styledHTML, baseURL: baseURL)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }
    
    // MARK: - Coordinator
    
    class Coordinator: NSObject, WKNavigationDelegate {
        // 拦截链接点击，在外部浏览器打开
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // 只允许主文档加载（即初始的 loadHTMLString）
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url {
                // 在外部浏览器打开
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            
            decisionHandler(.allow)
        }
    }
    
    // MARK: - HTML Building
    
    /// 构建带样式的完整 HTML
    private func buildStyledHTML(_ bodyHTML: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                \(cssStyles)
            </style>
        </head>
        <body>
            \(bodyHTML)
        </body>
        </html>
        """
    }
    
    /// 统一 CSS 样式
    private var cssStyles: String {
        """
        /* 基础样式 */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            font-size: 15px;
            line-height: 1.6;
            color: #333;
            padding: 16px;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        /* 标题 */
        h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 12px;
            font-weight: 600;
            line-height: 1.3;
        }
        
        h1 { font-size: 28px; }
        h2 { font-size: 24px; }
        h3 { font-size: 20px; }
        h4 { font-size: 18px; }
        h5 { font-size: 16px; }
        h6 { font-size: 15px; }
        
        h1:first-child,
        h2:first-child,
        h3:first-child {
            margin-top: 0;
        }
        
        /* 段落 */
        p {
            margin-bottom: 16px;
        }
        
        p:last-child {
            margin-bottom: 0;
        }
        
        /* 列表 */
        ul, ol {
            margin-bottom: 16px;
            padding-left: 24px;
        }
        
        li {
            margin-bottom: 8px;
        }
        
        li:last-child {
            margin-bottom: 0;
        }
        
        /* 引用 */
        blockquote {
            margin: 16px 0;
            padding: 12px 16px;
            border-left: 4px solid #ddd;
            background-color: #f9f9f9;
            color: #666;
            font-style: italic;
        }
        
        /* 链接 */
        a {
            color: #007AFF;
            text-decoration: none;
        }
        
        a:hover {
            text-decoration: underline;
        }
        
        /* 代码 */
        code {
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
            font-size: 13px;
            background-color: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        pre {
            margin: 16px 0;
            padding: 12px;
            background-color: #f5f5f5;
            border-radius: 6px;
            overflow-x: auto;
        }
        
        pre code {
            background-color: transparent;
            padding: 0;
        }
        
        /* 图片 */
        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 16px 0;
            border-radius: 6px;
        }
        
        /* 分隔线 */
        hr {
            margin: 24px 0;
            border: none;
            border-top: 1px solid #ddd;
        }
        
        /* 表格（基础支持） */
        table {
            width: 100%;
            margin: 16px 0;
            border-collapse: collapse;
        }
        
        th, td {
            padding: 8px 12px;
            border: 1px solid #ddd;
            text-align: left;
        }
        
        th {
            background-color: #f5f5f5;
            font-weight: 600;
        }
        
        /* 深色模式支持（可选） */
        @media (prefers-color-scheme: dark) {
            body {
                color: #ddd;
                background-color: transparent;
            }
            
            blockquote {
                background-color: rgba(255, 255, 255, 0.05);
                border-left-color: #555;
                color: #aaa;
            }
            
            code {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            pre {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            a {
                color: #0A84FF;
            }
            
            th {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            th, td {
                border-color: #555;
            }
            
            hr {
                border-top-color: #555;
            }
        }
        """
    }
}

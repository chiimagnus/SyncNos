# SyncNos - iFlow Context

## 项目概述

SyncNos 是一个原生 macOS 应用程序，使用 SwiftUI 和 Swift 5.0 开发，专注于将 Apple Books 和 GoodLinks 应用中的高亮笔记同步到 Notion。项目采用现代化的 MVVM 架构，结合 Combine 响应式编程，严格遵循 SwiftUI 最佳实践。

## 技术栈与架构

### 核心框架
- **平台**: macOS 13+ (部署目标 15.4)
- **语言**: Swift 5.0
- **UI框架**: SwiftUI 5.0
- **架构模式**: MVVM + Combine 响应式编程
- **依赖管理**: 原生 Swift Package Manager

### 项目结构
```
SyncNos/
├── Models/                    # 数据模型层
├── Services/                  # 业务逻辑层
│   ├── 0-NotionAPI/          # Notion API 集成
│   ├── 1-AppleBooks/         # Apple Books 数据访问
│   ├── 2-GoodLinks/          # GoodLinks 数据访问
│   ├── Infrastructure/       # 基础设施服务
│   └── IAP/                  # 应用内购买
├── ViewModels/               # 视图模型层
├── Views/                    # SwiftUI 视图层
└── SyncNosApp.swift         # 应用入口

Backend/                      # FastAPI 后端服务
├── app/                      # Python FastAPI 应用
│   ├── api/v1/              # REST API 端点
│   ├── core/                # 核心配置
│   ├── security/            # Apple 登录认证
│   └── services/            # 业务服务
└── requirements.txt         # Python 依赖
```

## 构建与运行

### macOS 客户端
```bash
# 使用 Xcode 打开项目
open SyncNos.xcodeproj

# 或使用 xcodebuild 命令行构建
xcodebuild -scheme SyncNos -configuration Debug build
```

### Python 后端服务
```bash
cd Backend/

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量 (创建 .env 文件)
cp .env.example .env
# 编辑 .env 文件填入 Apple 登录配置

# 启动服务
uvicorn app.main:app --reload --port 8000

# 访问 API 文档
open http://127.0.0.1:8000/docs
```

## 开发约定与最佳实践

### 架构原则
1. **组合优于继承**: 使用依赖注入和协议组合
2. **接口优于单例**: 通过 DIContainer 管理服务依赖
3. **显式优于隐式**: 清晰的数据流和依赖关系
4. **SOLID 原则**: 严格的单一职责和接口隔离

### 编码规范
- **MVVM 架构**: View → ViewModel → Service → Model
- **Combine 响应式**: 使用 `@Published` 和 `ObservableObject`
- **SwiftUI 最佳实践**: 使用 `@State`, `@ObservedObject`, `@EnvironmentObject`
- **错误处理**: 使用 `Result` 类型和 `throw` 机制
- **日志记录**: 统一使用 `LoggerService` 进行分级日志

### 依赖注入模式
```swift
// 服务协议定义
protocol NotionServiceProtocol {
    func syncToNotion(data: SyncData) async throws
}

// DIContainer 管理
class DIContainer {
    static let shared = DIContainer()
    
    var notionService: NotionServiceProtocol {
        NotionService(configStore: notionConfigStore)
    }
}

// ViewModel 中使用
@MainActor
final class MyViewModel: ObservableObject {
    private let notionService: NotionServiceProtocol
    
    init(notionService: NotionServiceProtocol = DIContainer.shared.notionService) {
        self.notionService = notionService
    }
}
```

### 数据同步策略
1. **单库模式**: 所有内容在一个 Notion 数据库中
2. **分库模式**: 每本书/链接单独一个数据库
3. **幂等同步**: 使用 UUID 确保不重复同步
4. **增量同步**: 基于时间戳的增量更新

### 安全与权限
- **App Sandbox**: 使用安全范围书签访问用户数据
- **只读访问**: 数据库访问仅限读取权限
- **密钥管理**: API 密钥安全存储在 Keychain
- **Apple 登录**: 使用 JWT 和 Apple 的公钥验证

## 核心功能模块

### Apple Books 集成
- **数据库访问**: 读取本地 SQLite 数据库 (AEAnnotation + BKLibrary)
- **数据提取**: 书籍信息、高亮文本、笔记、样式、时间戳
- **文件监控**: 自动检测最新的数据库文件
- **分页加载**: 大量高亮数据的分页处理

### GoodLinks 集成
- **数据库访问**: 读取 GoodLinks SQLite 数据库
- **内容提取**: 文章链接、标题、内容、标签、高亮
- **标签解析**: 支持 GoodLinks 的标签系统
- **全文内容**: 获取文章完整正文

### Notion API 集成
- **数据库操作**: 创建、查询、更新 Notion 数据库
- **页面管理**: 创建和管理 Notion 页面
- **富文本支持**: 高亮和笔记的富文本格式
- **批量操作**: 支持批量创建和更新

### 自动同步服务
- **后台同步**: 定时自动同步功能
- **状态监控**: 同步状态实时显示
- **错误重试**: 失败重试机制
- **用户配置**: 可配置的同步频率

## 测试与验证

### 手动测试流程
1. **Apple Books 测试**:
   - 确保有高亮笔记的书籍存在
   - 验证数据库文件访问权限
   - 测试同步到 Notion 的功能

2. **GoodLinks 测试**:
   - 准备包含高亮的 GoodLinks 数据
   - 验证数据库连接和读取
   - 测试标签解析和内容提取

3. **Notion 集成测试**:
   - 验证 API 密钥和页面 ID 配置
   - 测试数据库创建和页面同步
   - 验证富文本格式和链接

### 调试与日志
- **日志级别**: Debug, Info, Warning, Error
- **日志查看**: 内置日志窗口查看器
- **错误追踪**: 详细的错误信息和堆栈跟踪
- **性能监控**: 同步操作的时间统计

## 部署与发布

### App Store 发布
- **Bundle ID**: `com.chiimagnus.macOS`
- **版本管理**: 遵循语义化版本控制
- **审核准备**: 符合 macOS App Store 审核指南
- **隐私合规**: 遵循 Apple 隐私政策

### 后端部署
- **环境配置**: 生产环境变量管理
- **容器化**: 支持 Docker 容器部署
- **监控**: 集成日志和性能监控
- **安全**: HTTPS 和 API 安全认证

## 相关资源

- **Apple 文档**: [Apple Books 数据访问说明](Resource/Apple%20Books%20数据访问说明（简要）.md)
- **GoodLinks 文档**: [GoodLinks 数据访问说明](SyncNos/Services/2-GoodLinks/GoodLinks数据访问说明.md)
- **技术博客**: [微信公众号文章](https://mp.weixin.qq.com/s/jeTko_mQbCe3DXUNpmjHHA)
- **Notion API**: [Notion Developers](https://developers.notion.com/)
- **Apple 登录**: [Sign in with Apple](https://developer.apple.com/sign-in-with-apple/)

## 开发路线图

### 当前功能 ✅
- Apple Books 高亮同步
- GoodLinks 文章同步
- Notion 单库/分库模式
- 自动同步功能
- Apple 登录认证
- 应用内购买

### 未来规划 🚧
- 微信读书集成
- 得到 App 集成
- 自定义同步规则
- 高级过滤和搜索
- 数据导出功能
- iOS/iPadOS 版本

---

**注意**: 本项目专注于 macOS 原生体验，使用最新的 SwiftUI 和 Swift 特性，致力于提供最佳的用户体验和代码质量。
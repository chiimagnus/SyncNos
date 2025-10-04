# SyncNos 业务总结文档

## 项目概述

SyncNos 是一个 macOS 应用程序，旨在将 Apple Books 和 GoodLinks
应用中的高亮笔记同步到 Notion 中，方便用户在 Notion
中管理和整理读书笔记和文章高亮。

## 核心业务功能

1. Apple Books 集成

- 数据库访问：读取 Apple Books 的本地 SQLite 数据库（AEAnnotation 和 BKLibrary）
- 数据提取：获取用户的书籍列表、高亮文本、笔记、样式、时间戳等信息
- 列表展示：显示包含高亮数量的书籍列表
- 详情查看：查看特定书籍的所有高亮和笔记，支持分页加载

2. GoodLinks 集成

- 数据库访问：读取 GoodLinks 应用的本地 SQLite 数据库
- 数据提取：获取用户收藏的链接、文章内容、高亮文本、笔记等信息
- 标签处理：支持 GoodLinks 中的标签解析和格式化
- 全文内容：获取文章的完整正文内容

3. Notion 同步功能

- 两种同步模式：
- 单库模式：所有书籍/链接在一个数据库中，每本书/链接为一个页面
- 每书/链接库模式：每本书/链接单独一个数据库，每个高亮为一条记录
- 幂等同步：使用 UUID 标记确保不会重复同步相同高亮
- 智能更新：支持全量同步和增量同步
- Rich Formatting：高亮和笔记以富文本格式传输到 Notion

## 架构设计

1. 服务层 (Services)

- 数据库服务：封装 SQLite 数据库的读取操作，包括连接管理、查询执行
- Notion 服务：封装 Notion API 的调用，处理认证、数据传输等
- 配置存储服务：管理用户配置（Notion API 密钥、页面 ID 等）
- 日志服务：提供分级日志记录功能

2. 数据模型 (Models)

- Highlight：表示单个高亮/笔记，包含文本、笔记、样式、时间戳等信息
- BookListItem：书籍列表项，包含书名、作者、高亮数量等
- GoodLinksLinkRow：GoodLinks 链接数据模型
- GoodLinksHighlightRow：GoodLinks 高亮数据模型

3. 视图模型 (ViewModels)

- BookViewModel：管理 Apple Books 相关数据流
- AppleBookDetailViewModel：管理特定书籍详情的分页加载和同步
- GoodLinksViewModel：管理 GoodLinks 相关数据流

4. 用户界面 (Views)

- 主列表视图：使用 NavigationSplitView
实现的主界面，左侧显示书籍/链接列表，右侧显示详情
- Apple Books 视图：展示 Apple Books 相关数据
- GoodLinks 视图：展示 GoodLinks 相关数据
- 设置视图：配置 Apple Books 容器路径和 Notion 集成

## 技术特点

1. 安全性设计

- 使用 App Sandbox 模型，通过安全范围书签访问用户数据
- 数据库访问仅限读取权限，确保数据安全
- 敏感配置信息（如 API 密钥）安全存储

2. 架构模式

- MVVM 模式：清晰的模型-视图-视图模型分离
- 依赖注入：通过 DIContainer 实现服务注入，便于测试
- 协议导向编程：定义服务协议，便于实现替换和测试

3. 性能优化

- 分页加载：对于大量高亮数据采用分页加载策略
- 只读会话：封装数据库连接生命周期，避免资源泄漏
- 异步处理：UI 操作异步执行，避免阻塞主线程

4. 用户体验

- 瀑布流布局：自定义 WaterfallLayout 实现响应式布局
- 实时同步状态：显示同步进度和状态信息
- 错误处理：友好的错误提示和状态反馈
- 多数据源切换：支持在 Apple Books 和 GoodLinks 之间切换

## 业务流程

1. 数据同步流程

1. 用户选择 Apple Books 或 GoodLinks 数据源
2. 应用扫描本地数据库，提取书籍/链接列表
3. 用户选择特定书籍/链接
4. 加载该书籍/链接的高亮数据
5. 用户触发同步到 Notion
6. 应用与 Notion API 通信，创建/更新页面和数据库
7. 显示同步结果

2. 数据流向

- 读取：Apple Books/GoodLinks SQLite → 数据库服务 → 视图模型 → UI
- 写入：UI 操作 → 视图模型 → Notion 服务 → Notion API

## 扩展性设计

1. 多数据源支持

- 通过 ContentSource 枚举支持 Apple Books 和 GoodLinks
- 架构设计支持未来扩展其他数据源（如微信读书、得到等）

2. 配置管理

- NotionConfigStore 支持 per-source 配置存储
- 灵活的同步模式配置

3. 插件化架构

- 协议定义清晰，便于添加新的数据源服务
- 统一的数据模型和同步流程
